import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { CommandError } from '../../errors.js';
import { createFakeLockEdges } from '../../test/lock-edges.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import { LOCK_POLL_MS, LOCK_SUFFIX } from '../constants.js';
import { withLock } from './lock.js';

const folders = createTempFolders();

/** An opaque process id that no test process has. */
const HOLDER_PID = 4242;
const DEAD_PID = 999_999;
const SHORT_TIMEOUT_MS = 100;

afterEach(() => folders.cleanUp());

const setUp = () => {
    const stateFile = path.join(folders.make('artemis-lock-'), 'state', 'worktrees.json');
    const lock = `${stateFile}${LOCK_SUFFIX}`;

    fs.mkdirSync(path.dirname(lock), { recursive: true });

    return { stateFile, lock };
};

const holdLock = (lock: string, holder: string) => fs.writeFileSync(lock, holder);

const holderIsAlive = (pid: number) => pid === HOLDER_PID;
const nobodyIsAlive = () => false;

describe('withLock', () => {
    test('runs the work and returns its result', () => {
        const { stateFile } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        expect(withLock(stateFile, () => 'done', edges)).toBe('done');
    });

    test('holds the lock, with the process id in it, while the work runs', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        expect(withLock(stateFile, () => fs.readFileSync(lock, 'utf8'), edges)).toBe(
            String(process.pid)
        );
    });

    test('releases the lock when the work is done', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        withLock(stateFile, () => undefined, edges);

        expect(fs.existsSync(lock)).toBe(false);
    });

    test('releases the lock when the work throws', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        thrownBy(() =>
            withLock(
                stateFile,
                () => {
                    throw new Error('work failed');
                },
                edges
            )
        );

        expect(fs.existsSync(lock)).toBe(false);
    });

    test('creates the folder of the state file when it does not exist yet', () => {
        const stateFile = path.join(folders.make('artemis-lock-'), 'not', 'there', 'state.json');

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        expect(withLock(stateFile, () => 'done', edges)).toBe('done');
    });
});

describe('withLock: another process holds the lock', () => {
    test('a registration waits while another live process holds the registry lock', () => {
        const { stateFile, lock } = setUp();
        const ran: boolean[] = [];

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS,
            onPause: () => fs.rmSync(lock, { force: true })
        });

        holdLock(lock, String(HOLDER_PID));
        withLock(stateFile, () => ran.push(true), edges);

        expect(pauses).toEqual([LOCK_POLL_MS]);
        expect(ran).toEqual([true]);
    });

    test('a lock left by a process that died is taken over', () => {
        const { stateFile, lock } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdLock(lock, String(DEAD_PID));

        expect(withLock(stateFile, () => 'took over', edges)).toBe('took over');
        expect(pauses).toEqual([]);
        expect(fs.existsSync(lock)).toBe(false);
    });

    test('an empty lock file is taken over', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdLock(lock, '');

        expect(withLock(stateFile, () => 'took over', edges)).toBe('took over');
    });

    test('gives up after the timeout, naming the holder', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdLock(lock, String(HOLDER_PID));

        expect(thrownBy(() => withLock(stateFile, () => 'never', edges))).toMatchObject({
            message: `The instance registry is locked by process ${HOLDER_PID}.`
        });
    });

    test('the timeout is a CommandError whose hint says which file to delete', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdLock(lock, String(HOLDER_PID));
        const error = thrownBy(() => withLock(stateFile, () => 'never', edges));

        expect(error).toBeInstanceOf(CommandError);

        expect(error).toMatchObject({
            hint: `If no other command is running, delete ${lock}.`
        });
    });

    test('a lock it did not take is left alone when it gives up', () => {
        const { stateFile, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        holdLock(lock, String(HOLDER_PID));
        thrownBy(() => withLock(stateFile, () => 'never', edges));

        expect(fs.readFileSync(lock, 'utf8')).toBe(String(HOLDER_PID));
    });
});
