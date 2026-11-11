import type { FakeLockEdges, FakeLockEdgesOptions } from './models.js';

/** An opaque process id for the process that takes the lock in a test. */
export const FAKE_PID = 31_337;

/**
 * Fixed, realistic stand-ins for the clock, process liveness and tokens; they record, never decide.
 * The clock starts at the real time, because lock files carry real modification times.
 */
export const createFakeLockEdges = ({
    pid = FAKE_PID,
    isProcessAlive,
    timeoutMs,
    onPause
}: FakeLockEdgesOptions): FakeLockEdges => {
    let now = Date.now();
    let tokens = 0;
    const pauses: number[] = [];

    return {
        pauses,
        edges: {
            pid,
            token: () => `token-${++tokens}`,
            now: () => now,
            isProcessAlive,
            timeoutMs,
            pause: (ms) => {
                pauses.push(ms);
                now += ms;
                onPause?.();
            }
        }
    };
};
