import { processId } from '../../edges/system.js';
import { LOCK_TIMEOUT_MS } from './constants.js';
import { isProcessAlive, newToken, now, pause, sleep } from './lock-edges.js';
import type { ResolveLockEdgesFn } from './models.js';

/** The lock options with their defaults applied: the real clock, liveness and waiting. */
export const resolveLockEdges: ResolveLockEdgesFn = (options = {}) => ({
    pid: processId(),
    token: newToken,
    now: options.now ?? now,
    isProcessAlive: options.isProcessAlive ?? isProcessAlive,
    pause: options.pause ?? pause,
    sleep: options.sleep ?? sleep,
    timeoutMs: options.lockTimeoutMs ?? LOCK_TIMEOUT_MS
});
