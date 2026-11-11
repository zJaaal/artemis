import { describe, expect, test } from 'vitest';

import { LOCK_TIMEOUT_MS } from './constants.js';
import { isProcessAlive, now, pause, sleep } from './lock-edges.js';
import { resolveLockEdges } from './lock-options.js';

const FIXED_NOW_MS = 1_700_000_000_000;
const SHORT_TIMEOUT_MS = 50;

describe('resolveLockEdges', () => {
    test('the process id is this process', () => {
        expect(resolveLockEdges().pid).toBe(process.pid);
    });

    test('with no options the clock, liveness, pause and sleep are the real ones', () => {
        const edges = resolveLockEdges();

        expect([edges.now, edges.isProcessAlive, edges.pause, edges.sleep]).toEqual([
            now,
            isProcessAlive,
            pause,
            sleep
        ]);
    });

    test('the timeout defaults to the lock timeout', () => {
        expect(resolveLockEdges().timeoutMs).toBe(LOCK_TIMEOUT_MS);
    });

    test('lockTimeoutMs sets the timeout', () => {
        expect(resolveLockEdges({ lockTimeoutMs: SHORT_TIMEOUT_MS }).timeoutMs).toBe(
            SHORT_TIMEOUT_MS
        );
    });

    test('an injected clock is used', () => {
        expect(resolveLockEdges({ now: () => FIXED_NOW_MS }).now()).toBe(FIXED_NOW_MS);
    });

    test('an injected liveness check is used', () => {
        expect(resolveLockEdges({ isProcessAlive: () => false }).isProcessAlive(process.pid)).toBe(
            false
        );
    });

    test('an injected pause is used', () => {
        const waited: number[] = [];

        resolveLockEdges({ pause: (ms) => waited.push(ms) }).pause(SHORT_TIMEOUT_MS);

        expect(waited).toEqual([SHORT_TIMEOUT_MS]);
    });

    test('an injected sleep is used', async () => {
        const waited: number[] = [];

        await resolveLockEdges({
            sleep: (ms) => {
                waited.push(ms);

                return Promise.resolve();
            }
        }).sleep(SHORT_TIMEOUT_MS);

        expect(waited).toEqual([SHORT_TIMEOUT_MS]);
    });

    test('every holder gets its own token', () => {
        const { token } = resolveLockEdges();

        expect(token()).not.toBe(token());
    });
});
