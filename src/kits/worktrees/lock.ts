import path from 'node:path';

import { createExclusive, makeDirectory, readTextIfExists, removeFile } from '../../edges/files.js';
import { CommandError } from '../../errors/errors.js';
import { LOCK_POLL_MS, LOCK_SUFFIX } from './constants.js';
import type { LockEdges, WithLockFn } from './models.js';

/** The process that holds the lock, or undefined when the file is empty, unreadable or gone. */
function holderOf(lock: string): number | undefined {
    const holder = Number(readTextIfExists(lock));

    return holder || undefined;
}

/** One round of waiting: take over a dead holder's lock, or fail after the deadline, or pause. */
function waitForHolder(lock: string, deadline: number, edges: LockEdges): void {
    const holder = holderOf(lock);

    if (holder === undefined || !edges.isProcessAlive(holder)) {
        removeFile(lock);

        return;
    }

    if (edges.now() > deadline) {
        throw new CommandError(`The instance registry is locked by process ${holder}.`, {
            hint: `If no other command is running, delete ${lock}.`
        });
    }

    edges.pause(LOCK_POLL_MS);
}

function acquire(lock: string, edges: LockEdges): void {
    const deadline = edges.now() + edges.timeoutMs;

    makeDirectory(path.dirname(lock));

    while (!createExclusive(lock, String(edges.pid))) {
        waitForHolder(lock, deadline, edges);
    }
}

/**
 * Runs `work` while holding `<stateFile>.lock`, so that two processes registering at once cannot
 * both read the registry, pick the same slot and overwrite each other. Synchronous like the rest
 * of the kit: it retries every few milliseconds, and takes over a lock whose process has died.
 */
export const withLock: WithLockFn = (stateFile, work, edges) => {
    const lock = `${stateFile}${LOCK_SUFFIX}`;

    acquire(lock, edges);

    try {
        return work();
    } finally {
        removeFile(lock);
    }
};
