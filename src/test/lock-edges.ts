import type { FakeLockEdges, FakeLockEdgesOptions } from './models.js';

/** An opaque process id for the process that takes the lock in a test. */
export const FAKE_PID = 31_337;

/** Fixed, realistic stand-ins for the clock and process liveness; they record, never decide. */
export const createFakeLockEdges = ({
    pid = FAKE_PID,
    isProcessAlive,
    timeoutMs,
    onPause
}: FakeLockEdgesOptions): FakeLockEdges => {
    let now = 0;
    const pauses: number[] = [];

    return {
        pauses,
        edges: {
            pid,
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
