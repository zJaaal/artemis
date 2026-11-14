import type { SleepSyncFn } from '../models.js';

// Edge: a pause that blocks the thread, for the few synchronous edges that have to wait (they cannot await).

/** Blocks the thread for `ms`, with `Atomics.wait` on a one-element array nobody ever notifies. */
export const sleepSync: SleepSyncFn = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms);
};
