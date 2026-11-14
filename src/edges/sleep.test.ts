import { describe, expect, test } from 'vitest';

import { sleepSync } from './sleep.js';

const PAUSE_MS = 30;
const CLOCK_TOLERANCE_MS = 5;

describe('sleepSync', () => {
    test('blocks the thread for at least the time asked', () => {
        const started = performance.now();

        sleepSync(PAUSE_MS);

        expect(performance.now() - started).toBeGreaterThanOrEqual(PAUSE_MS - CLOCK_TOLERANCE_MS);
    });
});
