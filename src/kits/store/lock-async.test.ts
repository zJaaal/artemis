import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { CommandError } from '../../errors/errors.js';
import { FAKE_PID, createFakeLockEdges } from '../../test/lock-edges.js';
import { createTempFolders } from '../../test/temp.js';
import { LOCK_SUFFIX, NAMED_LOCK_POLL_MS } from './constants.js';
import { withLockAsync } from './lock.js';
import type { LockHolder } from './models.js';

const folders = createTempFolders();

/** Opaque process ids: one that is alive, one that is gone. */
const HOLDER_PID = 4242;
const DEAD_PID = 999_999;
const SHORT_TIMEOUT_MS = 100;
const MINUTES_OF_WAITING_MS = 600_000;
const POLL_MS = 50;
const WAITS_BEFORE_RELEASE = 3;
/** Short polls, so a lock with no pid yet is still inside its grace period when the wait gives up. */
const UNREADABLE_POLL_MS = 10;

afterEach(() => folders.cleanUp());

const setUp = () => {
    const file = path.join(folders.make('artemis-named-lock-'), 'build');
    const lock = `${file}${LOCK_SUFFIX}`;

    return { file, lock };
};

/** The other process lets go: only its lock is removed, never one this process took since. */
const releaseTheirs = (lock: string) => {
    if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === `${HOLDER_PID} theirs`) {
        fs.rmSync(lock);
    }
};

const holderIsAlive = (pid: number) => pid === HOLDER_PID;
const nobodyIsAlive = () => false;

describe('withLockAsync', () => {
    test('runs the work and returns its result', async () => {
        const { file } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        expect(await withLockAsync(file, async () => 'built', edges)).toBe('built');
    });

    test('holds the lock, with the process id and a token in it, while the work runs', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        expect(await withLockAsync(file, () => fs.readFileSync(lock, 'utf8'), edges)).toBe(
            `${FAKE_PID} token-1`
        );
    });

    test('releases the lock when the work is done', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        await withLockAsync(file, () => undefined, edges);

        expect(fs.existsSync(lock)).toBe(false);
    });

    test('releases the lock when the work rejects', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        await withLockAsync(file, () => Promise.reject(new Error('build failed')), edges).catch(
            () => undefined
        );

        expect(fs.existsSync(lock)).toBe(false);
    });

    test('a lock left by a dead process is taken over without waiting', async () => {
        const { file, lock } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        fs.mkdirSync(path.dirname(lock), { recursive: true });
        fs.writeFileSync(lock, `${DEAD_PID} gone`);

        expect(await withLockAsync(file, () => 'took over', edges)).toBe('took over');
        expect(pauses).toEqual([]);
    });
});

describe('withLockAsync: another process holds the lock', () => {
    const heldBySomeoneElse = (waitsBeforeRelease: number) => {
        const { file, lock } = setUp();
        let waits = 0;

        const fake = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS,
            onPause: () => {
                waits += 1;

                if (waits >= waitsBeforeRelease) {
                    fs.rmSync(lock, { force: true });
                }
            }
        });

        fs.mkdirSync(path.dirname(lock), { recursive: true });
        fs.writeFileSync(lock, `${HOLDER_PID} theirs`);

        return { file, lock, ...fake };
    };

    test('waits for the holder and then runs, polling at the default pace', async () => {
        const { file, edges, pauses } = heldBySomeoneElse(1);

        await withLockAsync(file, () => undefined, edges);

        expect(pauses).toEqual([NAMED_LOCK_POLL_MS]);
    });

    test('onWait is told who holds the lock', async () => {
        const { file, edges } = heldBySomeoneElse(1);
        const holders: LockHolder[] = [];

        await withLockAsync(file, () => undefined, edges, {
            onWait: (holder) => holders.push(holder)
        });

        expect(holders).toEqual([{ pid: HOLDER_PID }]);
    });

    test('onWait is called once however long the wait lasts', async () => {
        const { file, edges } = heldBySomeoneElse(WAITS_BEFORE_RELEASE);
        const holders: LockHolder[] = [];

        await withLockAsync(file, () => undefined, edges, {
            onWait: (holder) => holders.push(holder)
        });

        expect(holders).toHaveLength(1);
    });

    test('pollMs sets how long it sleeps between looks', async () => {
        const { file, edges, pauses } = heldBySomeoneElse(1);

        await withLockAsync(file, () => undefined, edges, { pollMs: POLL_MS });

        expect(pauses).toEqual([POLL_MS]);
    });

    test('without a timeout it waits as long as it takes, past the lock timeout of the edges', async () => {
        const { file, edges } = heldBySomeoneElse(MINUTES_OF_WAITING_MS / NAMED_LOCK_POLL_MS);

        expect(await withLockAsync(file, () => 'got it', edges)).toBe('got it');
    });

    test('gives up after timeoutMs, naming the file and the holder', async () => {
        const { file, edges } = heldBySomeoneElse(MINUTES_OF_WAITING_MS);

        await expect(
            withLockAsync(file, () => 'never', edges, {
                timeoutMs: SHORT_TIMEOUT_MS,
                pollMs: POLL_MS
            })
        ).rejects.toMatchObject({ message: `${file} is locked by process ${HOLDER_PID}.` });
    });

    test('the timeout is a CommandError whose hint says which file to delete', async () => {
        const { file, lock, edges } = heldBySomeoneElse(MINUTES_OF_WAITING_MS);

        const failure = withLockAsync(file, () => 'never', edges, {
            timeoutMs: SHORT_TIMEOUT_MS,
            pollMs: POLL_MS
        });

        await expect(failure).rejects.toBeInstanceOf(CommandError);

        await expect(failure).rejects.toMatchObject({
            hint: `If no other command is running, delete ${lock}.`
        });
    });

    test('a lock it did not take is left alone when it gives up', async () => {
        const { file, lock, edges } = heldBySomeoneElse(MINUTES_OF_WAITING_MS);

        await withLockAsync(file, () => 'never', edges, {
            timeoutMs: SHORT_TIMEOUT_MS,
            pollMs: POLL_MS
        }).catch(() => undefined);

        expect(fs.readFileSync(lock, 'utf8')).toBe(`${HOLDER_PID} theirs`);
    });
});

describe('withLockAsync: asking again from the same process', () => {
    test('a nested call for a lock this process holds fails at once, naming it', async () => {
        const { file } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        const nested = withLockAsync(file, () => withLockAsync(file, () => 'again', edges), edges);

        await expect(nested).rejects.toMatchObject({
            message: `${path.basename(file)} is already held by this process.`
        });

        expect(pauses).toEqual([]);
    });

    test('an unrelated call started while the first one works waits for it, and succeeds', async () => {
        const { file } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: (pid) => pid === FAKE_PID,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        const order: string[] = [];

        const first = withLockAsync(
            file,
            () => Promise.resolve().then(() => order.push('first')),
            edges
        );

        const second = withLockAsync(file, () => order.push('second'), edges);

        await Promise.all([first, second]);

        expect(order).toEqual(['first', 'second']);
    });

    test('two unrelated calls that both find another process holding it both queue, and neither fails', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: (pid) => pid === FAKE_PID || pid === HOLDER_PID,
            timeoutMs: SHORT_TIMEOUT_MS,
            onPause: () => releaseTheirs(lock)
        });

        fs.writeFileSync(lock, `${HOLDER_PID} theirs`);

        const results = await Promise.all([
            withLockAsync(file, () => 'one', edges),
            withLockAsync(file, () => 'two', edges)
        ]);

        expect(results).toEqual(['one', 'two']);
    });

    test('the lock can be asked for again once the first call is done', async () => {
        const { file } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        await withLockAsync(file, () => undefined, edges);

        expect(await withLockAsync(file, () => 'second time', edges)).toBe('second time');
    });
});

describe('withLockAsync: the label of a named lock', () => {
    const LABEL = 'build of core-feat-x';

    const writeLock = (lock: string, content: string) => {
        fs.mkdirSync(path.dirname(lock), { recursive: true });
        fs.writeFileSync(lock, content);
    };

    test('is written after the pid and the token while the work runs', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        const content = await withLockAsync(file, () => fs.readFileSync(lock, 'utf8'), edges, {
            label: LABEL
        });

        expect(content).toBe(`${FAKE_PID} token-1 ${LABEL}`);
    });

    test('is released like any lock: only if the whole content is still ours', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        await withLockAsync(file, () => undefined, edges, { label: LABEL });

        expect(fs.existsSync(lock)).toBe(false);
    });

    test('a lock file written with a label is read for its pid: a holder that is alive makes it wait', async () => {
        const { file, lock } = setUp();
        const told: LockHolder[] = [];

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS,
            onPause: () => fs.rmSync(lock, { force: true })
        });

        writeLock(lock, `${HOLDER_PID} theirs ${LABEL}`);

        await withLockAsync(file, () => undefined, edges, {
            onWait: (holder) => told.push(holder)
        });

        expect(told).toEqual([{ pid: HOLDER_PID, label: LABEL }]);
    });

    test('and a holder that is gone has it taken over, whatever label it wrote', async () => {
        const { file, lock } = setUp();

        const { edges, pauses } = createFakeLockEdges({
            isProcessAlive: nobodyIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        writeLock(lock, `${DEAD_PID} gone ${LABEL}`);

        expect(await withLockAsync(file, () => 'took over', edges)).toBe('took over');
        expect(pauses).toEqual([]);
    });

    test('the error after a timeout names the process and the job', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        writeLock(lock, `${HOLDER_PID} theirs ${LABEL}`);

        await expect(
            withLockAsync(file, () => 'never', edges, { timeoutMs: SHORT_TIMEOUT_MS })
        ).rejects.toMatchObject({
            message: `${file} is locked by process ${HOLDER_PID} (${LABEL}).`
        });
    });

    test('with no readable pid it says "an unknown process"', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        writeLock(lock, `? theirs ${LABEL}`);

        await expect(
            withLockAsync(file, () => 'never', edges, {
                timeoutMs: SHORT_TIMEOUT_MS,
                pollMs: UNREADABLE_POLL_MS
            })
        ).rejects.toMatchObject({
            message: `${file} is locked by an unknown process (${LABEL}).`
        });
    });

    test('without a label the error is the one it always was', async () => {
        const { file, lock } = setUp();

        const { edges } = createFakeLockEdges({
            isProcessAlive: holderIsAlive,
            timeoutMs: SHORT_TIMEOUT_MS
        });

        writeLock(lock, `${HOLDER_PID} theirs`);

        await expect(
            withLockAsync(file, () => 'never', edges, { timeoutMs: SHORT_TIMEOUT_MS })
        ).rejects.toMatchObject({
            message: `${file} is locked by process ${HOLDER_PID}.`
        });
    });
});
