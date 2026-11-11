import { describe, expect, test } from 'vitest';

import { MAX_INSTANCE_NAME_LENGTH } from './constants.js';
import { toWorktreeName } from './names.js';

describe('toWorktreeName', () => {
    test('a folder name becomes a lowercase dashed instance name', () => {
        expect(toWorktreeName('Core_Feat X')).toBe('core-feat-x');
    });

    test('digits and dashes are kept', () => {
        expect(toWorktreeName('feat-2')).toBe('feat-2');
    });

    test('leading and trailing dashes are trimmed', () => {
        expect(toWorktreeName('--Feat--')).toBe('feat');
    });

    test('a long name is cut to the maximum length', () => {
        expect(toWorktreeName('a'.repeat(MAX_INSTANCE_NAME_LENGTH + 9))).toHaveLength(
            MAX_INSTANCE_NAME_LENGTH
        );
    });

    test('a name with nothing usable is empty', () => {
        expect(toWorktreeName('___')).toBe('');
    });
});
