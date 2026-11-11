import { ERROR_CODE } from '../../constants.js';
import { INT32_BYTES, PROBE_SIGNAL } from './constants.js';
import type { IsProcessAliveFn, NowFn, PauseFn } from './models.js';
import { codeOf } from '../../utils/error-code.js';

// Edges of the registry lock: the clock, process liveness, and waiting.

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

/** A blocking wait: the kit is synchronous like the rest of its callers. */
export const pause: PauseFn = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(INT32_BYTES)), 0, 0, ms);
};
