import { describe, expect, test } from 'vitest';

import { isThenable } from './is-thenable.js';

describe('isThenable', () => {
    test('a promise is thenable', () => {
        expect(isThenable(Promise.resolve(1))).toBe(true);
    });

    test('an object with a then function is thenable', () => {
        expect(isThenable({ then: () => undefined })).toBe(true);
    });

    test('an object with a then that is not a function is not', () => {
        expect(isThenable({ then: 1 })).toBe(false);
    });

    test('a plain object is not thenable', () => {
        expect(isThenable({ a: 1 })).toBe(false);
    });

    test('null is not thenable', () => {
        expect(isThenable(null)).toBe(false);
    });

    test('undefined is not thenable', () => {
        expect(isThenable(undefined)).toBe(false);
    });

    test('a string is not thenable', () => {
        expect(isThenable('then')).toBe(false);
    });
});
