import { describe, expect, test } from 'vitest';

import { hasTag } from './tag.js';

const TAG = Symbol.for('artemis.test-tag');

describe('hasTag', () => {
    test('is true for an object that carries the tag', () => {
        expect(hasTag({ [TAG]: true }, TAG)).toBe(true);
    });

    test('is false for an object without it', () => {
        expect(hasTag({}, TAG)).toBe(false);
    });

    test('is false for something that is not an object', () => {
        expect(hasTag('text', TAG)).toBe(false);
    });

    test('is false for null', () => {
        expect(hasTag(null, TAG)).toBe(false);
    });

    test('finds a tag put there by another copy of the package, since Symbol.for is shared', () => {
        expect(hasTag({ [Symbol.for('artemis.test-tag')]: true }, TAG)).toBe(true);
    });
});
