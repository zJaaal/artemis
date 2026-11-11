import { randomUUID } from 'node:crypto';
import { setTimeout as sleepFor } from 'node:timers/promises';

import { ERROR_CODE } from '../../constants.js';
import { codeOf } from '../../utils/error-code.js';
import { INT32_BYTES, PROBE_SIGNAL } from './constants.js';
import type { IsProcessAliveFn, NowFn, PauseFn, SleepFn, TokenFn } from './models.js';

// Edges of the lock: the clock, process liveness, and waiting.

/** The real clock. */
export const now: NowFn = () => Date.now();

/** Signal 0 only asks whether the process exists. Someone else's process (EPERM) is alive too. */
export const isProcessAlive: IsProcessAliveFn = (pid) => {
    try {
        process.kill(pid, PROBE_SIGNAL);

        return true;
    } catch (error) {
        return codeOf(error) === ERROR_CODE.PERMISSION_DENIED;
    }
};

/** A blocking wait: documents are synchronous like the rest of their callers. */
export const pause: PauseFn = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(INT32_BYTES)), 0, 0, ms);
};

/** A wait that lets the process do other things: for the asynchronous named lock. */
export const sleep: SleepFn = async (ms, signal) => {
    try {
        await sleepFor(ms, undefined, { signal });
    } catch (error) {
        // Aborting is how a caller says it no longer needs the wait: that is not a failure.
        if (codeOf(error) !== ERROR_CODE.ABORTED) {
            throw error;
        }
    }
};

/** A token that tells one holder from another with the same process id. */
export const newToken: TokenFn = () => randomUUID();
