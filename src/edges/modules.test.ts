import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { isCommand } from '../define/define.js';
import { BAD_COMMANDS_FIXTURE_DIR, COMMANDS_FIXTURE_DIR } from '../test/constants.js';
import { importDefault } from './modules.js';

describe('importDefault', () => {
    test('returns the default export of a module file', async () => {
        expect(isCommand(await importDefault(path.join(COMMANDS_FIXTURE_DIR, 'hello.js')))).toBe(
            true
        );
    });

    test('is undefined for a module without a default export', async () => {
        expect(await importDefault(path.join(COMMANDS_FIXTURE_DIR, '_helper.js'))).toBeUndefined();
    });

    test('rejects with the error of a module that throws when it loads', async () => {
        await expect(
            importDefault(path.join(BAD_COMMANDS_FIXTURE_DIR, 'throws.js'))
        ).rejects.toThrow('this file cannot even load');
    });
});
