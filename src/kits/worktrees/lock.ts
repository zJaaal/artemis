import path from 'node:path';

import {
    createExclusive,
    makeDirectory,
    modifiedAt,
    readTextIfExists,
    removeFile
} from '../../edges/files.js';
import { CommandError } from '../../errors/errors.js';
import {
    LOCK_GRACE_MS,
    LOCK_POLL_MS,
    LOCK_SUFFIX,
    TAKEOVER_STALE_MS,
    TAKEOVER_SUFFIX
} from './constants.js';
import type { LockAttempt, LockEdges, WithLockFn } from './models.js';

/** The process id a lock names (`<pid> <token>`), or undefined when it holds none yet. */
const holderPid = (content: string): number | undefined =>
    Number.parseInt(content, 10) || undefined;

/** How long ago a file was written, by the injected clock; undefined when it is not there. */
function ageOf(file: string, edges: LockEdges): number | undefined {
    const written = modifiedAt(file);

    return written === undefined ? undefined : edges.now() - written;
}

/** A lock with no process id in it is probably being written right now: give it a moment. */
const isBeingWritten = (lock: string, edges: LockEdges): boolean =>
    (ageOf(lock, edges) ?? LOCK_GRACE_MS) < LOCK_GRACE_MS;

function isHeld(lock: string, observed: string, edges: LockEdges): boolean {
    const pid = holderPid(observed);

    return pid === undefined ? isBeingWritten(lock, edges) : edges.isProcessAlive(pid);
}

function lockedMessage(observed: string): string {
    const pid = holderPid(observed);

    return `The instance registry is locked by ${pid === undefined ? 'another process' : `process ${pid}`}.`;
}

/** The lock is held by someone alive: wait a little, or give up once the deadline has passed. */
function waitOrFail({ lock, deadline, edges }: LockAttempt, observed: string): void {
    if (edges.now() > deadline) {
        throw new CommandError(lockedMessage(observed), {
            hint: `If no other command is running, delete ${lock}.`
        });
    }

    edges.pause(LOCK_POLL_MS);
}

/** Whoever was taking over died half way: its guard is old enough to clear. */
function clearAbandonedGuard(guard: string, edges: LockEdges): void {
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
function takeOver({ lock, ownership, edges }: LockAttempt, observed: string): void {
    const guard = `${lock}${TAKEOVER_SUFFIX}`;

    if (!createExclusive(guard, ownership)) {
        clearAbandonedGuard(guard, edges);
        edges.pause(LOCK_POLL_MS);

        return;
    }

    try {
        if (readTextIfExists(lock) === observed) {
            removeFile(lock);
        }
    } finally {
        removeFile(guard);
    }
}

/** The lock exists: wait for its holder, or take it over if the holder is gone. */
function contend(attempt: LockAttempt): void {
    const observed = readTextIfExists(attempt.lock);

    // Released while we looked: just try to create it again.
    if (observed === undefined) {
        return;
    }

    if (isHeld(attempt.lock, observed, attempt.edges)) {
        waitOrFail(attempt, observed);
    } else {
        takeOver(attempt, observed);
    }
}

function acquire(attempt: LockAttempt): void {
    makeDirectory(path.dirname(attempt.lock));

    while (!createExclusive(attempt.lock, attempt.ownership)) {
        contend(attempt);
    }
}

/** Gives the lock back, but only if it is still ours: never delete one another process holds. */
function release({ lock, ownership }: LockAttempt): void {
    if (readTextIfExists(lock) === ownership) {
        removeFile(lock);
    }
}

/**
 * Runs `work` while holding `<stateFile>.lock`, so that two processes registering at once cannot
 * both read the registry, pick the same slot and overwrite each other. Synchronous like the rest
 * of the kit: it retries every few milliseconds, and takes over a lock whose process has died.
 */
export const withLock: WithLockFn = (stateFile, work, edges) => {
    const attempt: LockAttempt = {
        lock: `${stateFile}${LOCK_SUFFIX}`,
        ownership: `${edges.pid} ${edges.token()}`,
        deadline: edges.now() + edges.timeoutMs,
        edges
    };

    acquire(attempt);

    try {
        return work();
    } finally {
        release(attempt);
    }
};
