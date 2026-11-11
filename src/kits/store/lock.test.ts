import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { CommandError } from '../../errors/errors.js';
import { createFakeLockEdges, FAKE_PID } from '../../test/lock-edges.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import {
    LOCK_GRACE_MS,
    LOCK_POLL_MS,
    LOCK_SUFFIX,
    TAKEOVER_STALE_MS,
    TAKEOVER_SUFFIX
} from './constants.js';
import { withLockSync } from './lock.js';

const folders = createTempFolders();

/** Opaque process ids: one that is alive, one that is gone, one that races us. */
const HOLDER_PID = 4242;
const DEAD_PID = 999_999;
const COMPETITOR_PID = 5151;
const SHORT_TIMEOUT_MS = 100;
const PATIENT_TIMEOUT_MS = 2000;
const AN_HOUR_MS = 3_600_000;

afterEach(() => folders.cleanUp());

const setUp = () => {
    const stateFile = path.join(folders.make('artemis-lock-'), 'state', 'worktrees.json');
    const lock = `${stateFile}${LOCK_SUFFIX}`;

    fs.mkdirSync(path.dirname(lock), { recursive: true });

    return { stateFile, lock, guard: `${lock}${TAKEOVER_SUFFIX}` };
};

const holdFile = (file: string, content: string) => fs.writeFileSync(file, content);

/** Makes a file look as if it was written a long time ago. */
const makeOld = (file: string, ageMs: number) => {
    const then = new Date(Date.now() - ageMs);

    fs.utimesSync(file, then, then);
};

const holderIsAlive = (pid: number) => pid === HOLDER_PID || pid === COMPETITOR_PID;
const nobodyIsAlive = () => false;

const quietEdges = () =>
    createFakeLockEdges({ isProcessAlive: nobodyIsAlive, timeoutMs: SHORT_TIMEOUT_MS }).edges;

describe('withLockSync', () => {
    test('runs the work and returns its result', () => {
        const { stateFile } = setUp();

        expect(withLockSync(stateFile, () => 'done', quietEdges())).toBe('done');
    });

    test('holds the lock, with the process id and a token in it, while the work runs', () => {
        const { stateFile, lock } = setUp();

        expect(withLockSync(stateFile, () => fs.readFileSync(lock, 'utf8'), quietEdges())).toBe(
            `${FAKE_PID} token-1`
        );
    });

    test('releases the lock when the work is done', () => {
        const { stateFile, lock } = setUp();

        withLockSync(stateFile, () => undefined, quietEdges());

        expect(fs.existsSync(lock)).toBe(false);
    });

    test('releases the lock when the work throws', () => {
        const { stateFile, lock } = setUp();

        thrownBy(() =>
            withLockSync(
                stateFile,
                () => {
                    throw new Error('work failed');
                },
                quietEdges()
            )
        );

        expect(fs.existsSync(lock)).toBe(false);
    });

    test('creates the folder of the state file when it does not exist yet', () => {
        const stateFile = path.join(folders.make('artemis-lock-'), 'not', 'there', 'state.json');

        expect(withLockSync(stateFile, () => 'done', quietEdges())).toBe('done');
    });

    test('leaves no staging files behind', () => {
        const { stateFile, lock } = setUp();

        withLockSync(stateFile, () => undefined, quietEdges());

        expect(fs.readdirSync(path.dirname(lock))).toEqual([]);
    });

    test('never deletes a lock that another process holds by the time the work is done', () => {
        const { stateFile, lock } = setUp();

        withLockSync(stateFile, () => holdFile(lock, `${COMPETITOR_PID} theirs`), quietEdges());

        expect(fs.readFileSync(lock, 'utf8')).toBe(`${COMPETITOR_PID} theirs`);
    });
});

describe('withLockSync: another process holds the lock', () => {
    test('a registration waits while another live process holds the registry lock', () => {
        const { stateFile, lock } = setUp();
        const ran: boolean[] = [];

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS,
            onPause: () => fs.rmSync(lock, { force: true })
        });

        holdFile(lock, `${HOLDER_PID} theirs`);
        withLockSync(stateFile, () => ran.push(true), edges);

        expect(pauses).toEqual([LOCK_POLL_MS]);
        expect(ran).toEqual([true]);
    });

    test('a lock left by a process that died is taken over', () => {
        const { stateFile, lock } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdFile(lock, `${DEAD_PID} gone`);

        expect(withLockSync(stateFile, () => 'took over', edges)).toBe('took over');
        expect(pauses).toEqual([]);
        expect(fs.existsSync(lock)).toBe(false);
    });

    test('gives up after the timeout, naming the holder', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdFile(lock, `${HOLDER_PID} theirs`);

        expect(thrownBy(() => withLockSync(stateFile, () => 'never', edges))).toMatchObject({
            message: `${stateFile} is locked by process ${HOLDER_PID}.`
        });
    });

    test('the timeout is a CommandError whose hint says which file to delete', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdFile(lock, `${HOLDER_PID} theirs`);
        const error = thrownBy(() => withLockSync(stateFile, () => 'never', edges));

        expect(error).toBeInstanceOf(CommandError);
        expect(error).toMatchObject({ hint: `If no other command is running, delete ${lock}.` });
    });

    test('a lock it did not take is left alone when it gives up', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdFile(lock, `${HOLDER_PID} theirs`);
        thrownBy(() => withLockSync(stateFile, () => 'never', edges));

        expect(fs.readFileSync(lock, 'utf8')).toBe(`${HOLDER_PID} theirs`);
    });
});

describe('withLockSync: a lock that is still being written', () => {
    test('an empty lock that was just created is not taken over during the grace period', () => {
        const { stateFile, lock } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: PATIENT_TIMEOUT_MS
        });

        holdFile(lock, '');
        withLockSync(stateFile, () => undefined, edges);

        expect(pauses.reduce((total, ms) => total + ms, 0)).toBeGreaterThanOrEqual(LOCK_GRACE_MS);
    });

    test('an empty lock that is older than the grace period is taken over at once', () => {
        const { stateFile, lock } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: PATIENT_TIMEOUT_MS
        });

        holdFile(lock, '');
        makeOld(lock, AN_HOUR_MS);
        withLockSync(stateFile, () => undefined, edges);

        expect(pauses).toEqual([]);
    });

    test('a fresh unreadable lock that never fills in is reported without a process id', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdFile(lock, '');

        expect(thrownBy(() => withLockSync(stateFile, () => 'never', edges))).toMatchObject({
            message: `${stateFile} is locked by another process.`
        });
    });
});

describe('withLockSync: taking over a stale lock', () => {
    test('does not remove a lock another process created after the stale one was seen', () => {
        const { stateFile, lock } = setUp();
        let raced = false;
        let seenWhileWaiting: string | undefined;

        const { edges } = createFakeLockEdges({
            // While we judge the stale holder dead, a competitor takes over first and locks.
            isProcessAlive: (pid) => {
                if (pid === DEAD_PID && !raced) {
                    raced = true;
                    holdFile(lock, `${COMPETITOR_PID} theirs`);
                }

                return pid === COMPETITOR_PID;
            },
            timeoutMs: SHORT_TIMEOUT_MS,
            onPause: () => {
                seenWhileWaiting = fs.readFileSync(lock, 'utf8');
                fs.rmSync(lock, { force: true });
            }
        });

        holdFile(lock, `${DEAD_PID} gone`);
        withLockSync(stateFile, () => undefined, edges);

        expect(seenWhileWaiting).toBe(`${COMPETITOR_PID} theirs`);
    });

    test('waits while another process is taking over, and then takes the lock', () => {
        const { stateFile, lock, guard } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: PATIENT_TIMEOUT_MS,
            onPause: () => fs.rmSync(guard, { force: true })
        });

        holdFile(lock, `${DEAD_PID} gone`);
        holdFile(guard, `${COMPETITOR_PID} taking over`);

        expect(withLockSync(stateFile, () => 'took over', edges)).toBe('took over');
        expect(pauses.length).toBeGreaterThan(0);
    });

    test('a takeover that was abandoned half way is cleared, so the lock is not stuck', () => {
        const { stateFile, lock, guard } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: PATIENT_TIMEOUT_MS
        });

        holdFile(lock, `${DEAD_PID} gone`);
        holdFile(guard, `${COMPETITOR_PID} died while taking over`);
        makeOld(guard, TAKEOVER_STALE_MS + AN_HOUR_MS);

        expect(withLockSync(stateFile, () => 'took over', edges)).toBe('took over');
        expect(fs.existsSync(guard)).toBe(false);
    });

    test('the guard is gone once the takeover is done', () => {
        const { stateFile, lock, guard } = setUp();

        holdFile(lock, `${DEAD_PID} gone`);
        withLockSync(stateFile, () => undefined, quietEdges());

        expect(fs.existsSync(guard)).toBe(false);
    });
});

describe('withLockSync: reentrancy', () => {
    test('a nested call on the lock this call holds runs without waiting', () => {
        const { stateFile } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        const result = withLockSync(
            stateFile,
            () => withLockSync(stateFile, () => 'inner', edges),
            edges
        );

        expect(result).toBe('inner');
        expect(pauses).toEqual([]);
    });

    test('a nested call does not release the lock when it ends', () => {
        const { stateFile, lock } = setUp();
        const edges = quietEdges();

        const stillThere = withLockSync(
            stateFile,
            () => {
                withLockSync(stateFile, () => undefined, edges);

                return fs.existsSync(lock);
            },
            edges
        );

        expect(stillThere).toBe(true);
    });

    test('a nested call on another file takes that file lock', () => {
        const { stateFile } = setUp();
        const otherFile = path.join(path.dirname(stateFile), 'other.json');
        const edges = quietEdges();

        const otherIsLocked = withLockSync(
            stateFile,
            () => withLockSync(otherFile, () => fs.existsSync(`${otherFile}${LOCK_SUFFIX}`), edges),
            edges
        );

        expect(otherIsLocked).toBe(true);
    });

    test('the lock is taken again after work that threw, not mistaken for held', () => {
        const { stateFile, lock } = setUp();
        const edges = quietEdges();

        thrownBy(() =>
            withLockSync(
                stateFile,
                () => {
                    throw new Error('work failed');
                },
                edges
            )
        );

        expect(withLockSync(stateFile, () => fs.existsSync(lock), edges)).toBe(true);
    });
});
