import type { FakeLockEdges, FakeLockEdgesOptions } from './models.js';

/** Fixed, realistic stand-ins for the clock and process liveness; they record, never decide. */
export const createFakeLockEdges = ({
    isProcessAlive,
    timeoutMs,
    onPause
}: FakeLockEdgesOptions): FakeLockEdges => {
    let now = 0;
    const pauses: number[] = [];

    return {
        pauses,
        edges: {
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
