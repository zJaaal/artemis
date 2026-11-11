import { describe, expect, test } from 'vitest';

import { ERROR_CODE } from '../constants.js';
import { readTextIfExists } from '../edges/files.js';
import { thrownBy } from '../test/thrown.js';
import { codeOf } from './error-code.js';

describe('codeOf', () => {
    test('reads the code of a Node system error', () => {
        const error = thrownBy(() => readTextIfExists(import.meta.dirname));

        expect(codeOf(error)).toBe('EISDIR');
    });

    test('knows the code of a missing file', () => {
        const error = thrownBy(() => {
            throw Object.assign(new Error('missing'), { code: ERROR_CODE.MISSING });
        });

        expect(codeOf(error)).toBe(ERROR_CODE.MISSING);
    });

    test('is undefined for an Error without a code', () => {
        expect(codeOf(new Error('plain'))).toBeUndefined();
    });

    test('is undefined for something that is not an Error', () => {
        expect(codeOf('ENOENT')).toBeUndefined();
    });

    test('is undefined when the code is not text', () => {
        expect(codeOf(Object.assign(new Error('odd'), { code: 2 }))).toBeUndefined();
    });
});
