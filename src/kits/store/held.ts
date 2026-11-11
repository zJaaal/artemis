import { AsyncLocalStorage } from 'node:async_hooks';

import type { CreateHeldLocksFn, HeldFrame } from './models.js';

/**
 * Remembers, per asynchronous flow, which locks it holds. A call made from inside the work of a
 * held lock is nested (waiting would be waiting for itself), while a call from an unrelated flow of
 * the same process is only concurrent, and queues like one from another process.
 *
 * A callback scheduled inside the work keeps the flow after the lock is released, so each lock is a
 * frame that is switched off when its work settles: only a frame still on counts as held.
 */
export const createHeldLocks: CreateHeldLocksFn = () => {
    const context = new AsyncLocalStorage<readonly HeldFrame[]>();

    return {
        isHeldHere: (key) =>
            (context.getStore() ?? []).some((frame) => frame.key === key && frame.active),
        holding: async (key, work) => {
            const frame: HeldFrame = { key, active: true };

            try {
                return await context.run([...(context.getStore() ?? []), frame], work);
            } finally {
                frame.active = false;
            }
        }
    };
};
