import { describe, expect, test } from 'vitest';

import { canDestroy } from './can-destroy.js';

describe('canDestroy', () => {
    test('true can', () => {
        expect(canDestroy(true)).toBe(true);
    });

    test('false cannot', () => {
        expect(canDestroy(false)).toBe(false);
    });

    test('a function can: nobody reading it can run it', () => {
        expect(canDestroy(({ flags }) => !flags['no-prune'])).toBe(true);
    });

    test('a word that says nothing (a built-in) cannot', () => {
        expect(canDestroy(undefined)).toBe(false);
    });
});
