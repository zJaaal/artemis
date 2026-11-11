import { describe, expect, test } from 'vitest';

import { isRecord } from './is-record.js';

describe('isRecord', () => {
    test('an object is a record', () => {
        expect(isRecord({ a: 1 })).toBe(true);
    });

    test('null is not a record', () => {
        expect(isRecord(null)).toBe(false);
    });

    test('an array is not a record', () => {
        expect(isRecord([])).toBe(false);
    });

    test('a string is not a record', () => {
        expect(isRecord('artemis')).toBe(false);
    });
});
