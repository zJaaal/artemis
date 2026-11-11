import { describe, expect, test } from 'vitest';

import { thrownBy } from '../../test/thrown.js';
import { MAX_DOC_NAME_LENGTH } from './constants.js';
import { assertDocName, isValidDocName } from './names.js';

describe('isValidDocName', () => {
    test.each([
        { name: 'a single word', value: 'instances' },
        { name: 'dashes inside', value: 'feature-flags' },
        { name: 'digits', value: 'v2-steps' },
        { name: 'a single character', value: 'a' },
        { name: 'the longest allowed', value: 'a'.repeat(MAX_DOC_NAME_LENGTH) }
    ])('accepts $name', ({ value }) => {
        expect(isValidDocName(value)).toBe(true);
    });

    test.each([
        { name: 'an empty string', value: '' },
        { name: 'uppercase', value: 'Instances' },
        { name: 'a leading dash', value: '-steps' },
        { name: 'a dot', value: 'steps.json' },
        { name: 'a slash', value: 'a/b' },
        { name: 'a parent folder', value: '..' },
        { name: 'a space', value: 'my steps' },
        { name: 'an underscore', value: 'my_steps' },
        { name: 'one character too many', value: 'a'.repeat(MAX_DOC_NAME_LENGTH + 1) }
    ])('rejects $name', ({ value }) => {
        expect(isValidDocName(value)).toBe(false);
    });
});

describe('assertDocName', () => {
    test('a valid name passes', () => {
        expect(thrownBy(() => assertDocName('instances'))).toBeUndefined();
    });

    test('a bad name is a TypeError that names it', () => {
        expect(thrownBy(() => assertDocName('Bad Name'))).toMatchObject({
            name: 'TypeError',
            message: expect.stringContaining('"Bad Name"')
        });
    });
});
