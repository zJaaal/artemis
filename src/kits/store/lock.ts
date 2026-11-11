import path from 'node:path';

import {
    createExclusive,
    makeDirectory,
    modifiedAt,
    readTextIfExists,
    removeFile
} from '../../edges/files.js';
import { CommandError } from '../../errors/errors.js';
import { createHeldLocks } from './held.js';
import {
    LOCK_GRACE_MS,
    LOCK_POLL_MS,
    LOCK_SUFFIX,
    NAMED_LOCK_POLL_MS,
    TAKEOVER_STALE_MS,
    TAKEOVER_SUFFIX
} from './constants.js';
import type {
    AlreadyHeldErrorFn,
    LockAttempt,
    LockEdges,
    LockHolder,
    LockStep,
    TryLockFn,
    WithLockAsyncFn,
    WithLockSyncFn
} from './models.js';

/**
 * Lock files this process holds through the synchronous driver. A nested call on one of them runs
 * its work directly: the work is synchronous, so nothing else in the process can run in between.
 */
const heldSynchronously = new Set<string>();

/** Lock files held by the asynchronous driver, per flow: async work interleaves, so these are not reentrant. */
const heldAsynchronously = createHeldLocks();

const ACQUIRED: LockStep = { kind: 'acquired' };
const RETRY: LockStep = { kind: 'retry' };

/** The process id a lock names (`<pid> <token>`), or undefined when it holds none yet. */
const holderPid = (content: string): number | undefined =>
    Number.parseInt(content, 10) || undefined;

/** How long ago a file was written, by the injected clock; undefined when it is not there. */
function ageOf(file: string, edges: LockAttempt['edges']): number | undefined {
    const written = modifiedAt(file);

    return written === undefined ? undefined : edges.now() - written;
}

/** A lock with no process id in it is probably being written right now: give it a moment. */
const isBeingWritten = (lock: string, edges: LockAttempt['edges']): boolean =>
    (ageOf(lock, edges) ?? LOCK_GRACE_MS) < LOCK_GRACE_MS;

function isHeld(lock: string, observed: string, edges: LockAttempt['edges']): boolean {
    const pid = holderPid(observed);

    return pid === undefined ? isBeingWritten(lock, edges) : edges.isProcessAlive(pid);
}

/** Whoever was taking over died half way: its guard is old enough to clear. */
function clearAbandonedGuard(guard: string, edges: LockAttempt['edges']): void {
    if ((ageOf(guard, edges) ?? 0) > TAKEOVER_STALE_MS) {
        removeFile(guard);
    }
}

/**
 * Removes a lock whose holder is gone. Only one process at a time may do it (the guard), and it
 * removes the lock only if it still holds exactly what was judged stale: if someone else got there
 * first and made a new lock, that one is left alone. While the stale file exists nobody else can
 * create a lock, so nothing can replace it between that check and the removal.
 */
function takeOver({ lock, ownership, edges }: LockAttempt, observed: string): LockStep {
    const guard = `${lock}${TAKEOVER_SUFFIX}`;

    if (!createExclusive(guard, ownership)) {
        clearAbandonedGuard(guard, edges);

        // Someone else is taking over: wait for them, as for any other holder.
        return { kind: 'wait', holder: { pid: holderPid(readTextIfExists(guard) ?? '') } };
    }

    try {
        if (readTextIfExists(lock) === observed) {
            removeFile(lock);
        }
    } finally {
        removeFile(guard);
    }

    return RETRY;
}

/** The lock exists: wait for its holder, or take it over if the holder is gone. */
function contend(attempt: LockAttempt): LockStep {
    const observed = readTextIfExists(attempt.lock);

    // Released while we looked: just try to create it again.
    if (observed === undefined) {
        return RETRY;
    }

    if (isHeld(attempt.lock, observed, attempt.edges)) {
        return { kind: 'wait', holder: { pid: holderPid(observed) } };
    }

    return takeOver(attempt, observed);
}

/** One attempt to take the lock: create it, or judge whoever holds it. Never waits. */
export const tryLock: TryLockFn = (attempt) =>
    createExclusive(attempt.lock, attempt.ownership) ? ACQUIRED : contend(attempt);

/** Gives the lock back, but only if it is still ours: never delete one another process holds. */
function release({ lock, ownership }: LockAttempt): void {
    if (readTextIfExists(lock) === ownership) {
        removeFile(lock);
    }
}

function attemptFor(file: string, edges: LockEdges): LockAttempt {
    return { lock: `${file}${LOCK_SUFFIX}`, ownership: `${edges.pid} ${edges.token()}`, edges };
}

/** A named lock the asking flow already holds: waiting for itself would never end. */
export const alreadyHeldError: AlreadyHeldErrorFn = (name) =>
    new CommandError(`${name} is already held by this process.`, {
        hint: 'Wait for the work that holds it to finish before asking for it again.'
    });

/** The lock is held by someone alive and the wait ran out. */
export function lockedError(file: string, lock: string, { pid }: LockHolder): CommandError {
    return new CommandError(
        `${file} is locked by ${pid === undefined ? 'another process' : `process ${pid}`}.`,
        { hint: `If no other command is running, delete ${lock}.` }
    );
}

/**
 * Runs `work` while holding `<file>.lock`, so that two processes changing the same file at once
 * cannot both read it and overwrite each other. Synchronous: it retries every few milliseconds,
 * and takes over a lock whose process has died. Reentrant within the process: a nested call on a
 * lock this call holds just runs its work.
 */
export const withLockSync: WithLockSyncFn = (file, work, edges) => {
    const attempt = attemptFor(file, edges);

    if (heldSynchronously.has(attempt.lock)) {
        return work();
    }

    const deadline = edges.now() + edges.timeoutMs;

    makeDirectory(path.dirname(attempt.lock));

    for (let step = tryLock(attempt); step.kind !== 'acquired'; step = tryLock(attempt)) {
        if (step.kind === 'wait') {
            if (edges.now() > deadline) {
                throw lockedError(file, attempt.lock, step.holder);
            }

            edges.pause(LOCK_POLL_MS);
        }
    }

    heldSynchronously.add(attempt.lock);

    try {
        return work();
    } finally {
        heldSynchronously.delete(attempt.lock);
        release(attempt);
    }
};

/**
 * Runs `work` while holding `<file>.lock`, waiting without blocking the process: for work that may
 * take minutes. `onWait` is told once who holds it. Concurrent calls queue, in this process as in
 * any other. Not reentrant: a call made from inside the work that holds the lock is told at once
 * instead of waiting for itself forever.
 */
export const withLockAsync: WithLockAsyncFn = async (file, work, edges, options = {}) => {
    const attempt = attemptFor(file, edges);
    const { onWait, pollMs = NAMED_LOCK_POLL_MS, timeoutMs } = options;

    if (heldAsynchronously.isHeldHere(attempt.lock)) {
        throw alreadyHeldError(path.basename(file));
    }

    const deadline = timeoutMs === undefined ? undefined : edges.now() + timeoutMs;
    let announced = false;

    makeDirectory(path.dirname(attempt.lock));

    // An unrelated call in this process finds the lock file taken and queues behind it.
    for (let step = tryLock(attempt); step.kind !== 'acquired'; step = tryLock(attempt)) {
        if (step.kind === 'wait') {
            if (deadline !== undefined && edges.now() > deadline) {
                throw lockedError(file, attempt.lock, step.holder);
            }

            if (!announced) {
                announced = true;
                onWait?.(step.holder);
            }

            await edges.sleep(pollMs);
        }
    }

    try {
        return await heldAsynchronously.holding(attempt.lock, work);
    } finally {
        release(attempt);
    }
};
