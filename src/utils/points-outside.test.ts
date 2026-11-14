import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { pointsOutside, relativeInside } from './points-outside.js';

describe('pointsOutside', () => {
    test('the folder itself is not outside', () => {
        expect(pointsOutside('/work', '/work')).toBe(false);
    });

    test('a folder below it is not outside', () => {
        expect(pointsOutside('/work/state', '/work')).toBe(false);
    });

    test('the parent is outside', () => {
        expect(pointsOutside('/', '/work')).toBe(true);
    });

    test('a sibling is outside', () => {
        expect(pointsOutside('/elsewhere/state', '/work')).toBe(true);
    });

    test('a folder whose name only starts with two dots is inside', () => {
        expect(pointsOutside('/work/..state', '/work')).toBe(false);
    });
});

describe('relativeInside', () => {
    test('is the path of the folder below, relative to the other', () => {
        expect(relativeInside('/work/data/state', '/work')).toBe(path.join('data', 'state'));
    });

    test('is empty for the folder itself', () => {
        expect(relativeInside('/work', '/work')).toBe('');
    });

    test('is undefined outside', () => {
        expect(relativeInside('/elsewhere', '/work')).toBeUndefined();
    });

    test('keeps a name that starts with two dots', () => {
        expect(relativeInside('/work/..state', '/work')).toBe('..state');
    });
});
