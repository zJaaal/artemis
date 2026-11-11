import { describe, expect, test } from 'vitest';

import { isBoolean, isText, isTextList } from './is-text.js';

describe('isBoolean', () => {
    test('false is a boolean', () => {
        expect(isBoolean(false)).toBe(true);
    });

    test('the text "true" is not', () => {
        expect(isBoolean('true')).toBe(false);
    });
});

describe('isText', () => {
    test('an empty string is text', () => {
        expect(isText('')).toBe(true);
    });

    test('a number is not', () => {
        expect(isText(1)).toBe(false);
    });
});

describe('isTextList', () => {
    test('an empty list is a list of text', () => {
        expect(isTextList([])).toBe(true);
    });

    test('a list of strings is', () => {
        expect(isTextList(['a', 'b'])).toBe(true);
    });

    test('a list with a number in it is not', () => {
        expect(isTextList(['a', 1])).toBe(false);
    });

    test('a single string is not a list', () => {
        expect(isTextList('a')).toBe(false);
    });
});
