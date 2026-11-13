import { describe, expect, test } from 'vitest';

import { pointsOutside } from './points-outside.js';

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
