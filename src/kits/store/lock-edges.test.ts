import { spawnSync } from 'node:child_process';

import { describe, expect, test } from 'vitest';

import { isProcessAlive, now, pause, sleep } from './lock-edges.js';

/** The pid of a process that ran and finished: real, and certainly not alive. */
const finishedProcessId = (): number => spawnSync(process.execPath, ['-e', '']).pid;

const INIT_PID = 1;
const CLOCK_TOLERANCE_MS = 1000;
const SHORT_PAUSE_MS = 1;
const LONG_SLEEP_MS = 600_000;

describe('isProcessAlive', () => {
    test('this very process is alive', () => {
        expect(isProcessAlive(process.pid)).toBe(true);
    });

    test('a process that finished is not alive', () => {
        expect(isProcessAlive(finishedProcessId())).toBe(false);
    });

    test('a process owned by someone else still counts as alive', () => {
        expect(isProcessAlive(INIT_PID)).toBe(true);
    });
});

describe('now and pause', () => {
    test('now is the current time in ms', () => {
        expect(Math.abs(now() - Date.now())).toBeLessThan(CLOCK_TOLERANCE_MS);
    });

    test('pause returns after waiting', () => {
        expect(() => pause(SHORT_PAUSE_MS)).not.toThrow();
    });
});

describe('sleep', () => {
    test('resolves after waiting', async () => {
        await expect(sleep(SHORT_PAUSE_MS)).resolves.toBeUndefined();
    });

    test('aborting it ends the wait early, without an error', async () => {
        const controller = new AbortController();
        const waiting = sleep(LONG_SLEEP_MS, controller.signal);

        controller.abort();

        await expect(waiting).resolves.toBeUndefined();
    });

    test('a signal that is already aborted ends it at once', async () => {
        await expect(sleep(LONG_SLEEP_MS, AbortSignal.abort())).resolves.toBeUndefined();
    });
});
