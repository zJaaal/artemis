import { describe, expect, test } from 'vitest';

import { isFlagToken } from './flag-token.js';

describe('isFlagToken', () => {
    test('a long flag is one', () => {
        expect(isFlagToken('--json')).toBe(true);
    });

    test('a short flag is one', () => {
        expect(isFlagToken('-y')).toBe(true);
    });

    test('a plain word is not', () => {
        expect(isFlagToken('math')).toBe(false);
    });
});
