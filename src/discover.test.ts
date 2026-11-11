import { describe, expect, test } from 'vitest';

import { discover } from './discover.js';
import {
    ALIAS_CLASH_FIXTURE_DIR,
    BAD_COMMANDS_FIXTURE_DIR,
    COMMANDS_FIXTURE_DIR,
    MISSING_FIXTURE_DIR
} from './test/constants.js';

describe('discover', () => {
    test('a top-level file is a command named after the file', async () => {
        const registry = await discover(COMMANDS_FIXTURE_DIR);

        expect(registry.commands.get('hello')?.definition.description).toBe('Greet someone');
    });

    test('a file inside a folder is a command named after the folder path', async () => {
        const registry = await discover(COMMANDS_FIXTURE_DIR);

        expect([...registry.commands.keys()]).toContain('math add');
    });

    test('a folder with commands is a topic described by its _topic.js', async () => {
        const registry = await discover(COMMANDS_FIXTURE_DIR);

        expect(registry.topics.get('math')).toEqual({ id: 'math', description: 'Arithmetic' });
    });

    test('files starting with an underscore are not commands', async () => {
        const registry = await discover(COMMANDS_FIXTURE_DIR);

        expect([...registry.commands.keys()]).not.toContain('_helper');
    });

    test('aliases point at their command id', async () => {
        const registry = await discover(COMMANDS_FIXTURE_DIR);

        expect(registry.aliases.get('m:add')).toBe('math add');
    });

    test('a file that does not export a command is skipped with a warning', async () => {
        const registry = await discover(BAD_COMMANDS_FIXTURE_DIR);

        expect(registry.warnings).toContainEqual(
            expect.stringContaining('oops.js is not a command')
        );
    });

    test('a file that fails to load is skipped with a warning', async () => {
        const registry = await discover(BAD_COMMANDS_FIXTURE_DIR);

        expect(registry.warnings).toContainEqual(
            expect.stringMatching(/throws\.js failed to load and was skipped: this file cannot/)
        );
    });

    test('a bad file does not take the good ones down', async () => {
        const registry = await discover(BAD_COMMANDS_FIXTURE_DIR);

        expect([...registry.commands.keys()]).toEqual(['good']);
    });

    test('an alias that is already a command is ignored with a warning', async () => {
        const registry = await discover(ALIAS_CLASH_FIXTURE_DIR);

        expect(registry.warnings).toEqual(['alias "b" of "a" is already taken; ignored']);
    });

    test('a missing commands folder is a warning, not a crash', async () => {
        const registry = await discover(MISSING_FIXTURE_DIR);

        expect(registry.warnings).toEqual([`commands folder not found: ${MISSING_FIXTURE_DIR}`]);
    });
});
