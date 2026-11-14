import { describe, expect, test } from 'vitest';

import { now } from './clock.js';

describe('now', () => {
    test('is the current time in milliseconds', () => {
        const before = Date.now();

        expect(now()).toBeGreaterThanOrEqual(before);
    });
});
