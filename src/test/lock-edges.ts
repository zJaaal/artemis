import type { FakeLockEdges, FakeLockEdgesOptions, FakeLockOptions } from './models.js';

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
            },
            sleep: (ms) => {
                pauses.push(ms);
                now += ms;
                onPause?.();

                return Promise.resolve();
            }
        }
    };
};

/** The same fakes as `LockOptions`, for `defineStore`: a store whose lock never sleeps for real. */
export const createFakeLockOptions = (options: FakeLockEdgesOptions): FakeLockOptions => {
    const { edges, pauses } = createFakeLockEdges(options);

    return {
        pauses,
        options: {
            now: edges.now,
            isProcessAlive: edges.isProcessAlive,
            pause: edges.pause,
            sleep: edges.sleep,
            lockTimeoutMs: edges.timeoutMs
        }
    };
};
