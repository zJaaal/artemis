import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { BUILTINS } from '../cli/constants.js';
import type { BriefManifest } from '../models.js';
import { art, envelope } from '../test/art.js';

const briefOf = async (...argv: string[]): Promise<BriefManifest> =>
    envelope(await art(['help', ...argv, '--json', '--brief'], { builtins: BUILTINS }))
        .result as BriefManifest;

const FULL_ONLY_KEYS = ['usage', 'args', 'flags', 'examples', 'aliases'];

describe('help --brief: the JSON', () => {
    test('has only the bin, topics, commands, builtins and the way to get more', async () => {
        expect(Object.keys(await briefOf())).toEqual([
            'bin',
            'topics',
            'commands',
            'builtins',
            'more'
        ]);
    });

    test('has no globalFlags', async () => {
        expect(await briefOf()).not.toHaveProperty('globalFlags');
    });

    test('a command entry has only id and description when it marks nothing', async () => {
        const hello = (await briefOf()).commands.find((command) => command.id === 'hello');

        expect(hello).toEqual({ id: 'hello', description: 'Greet someone' });
    });

    test('no command entry has a key of the full manifest', async () => {
        const keys = (await briefOf()).commands.flatMap((command) => Object.keys(command));

        expect(keys.filter((key) => FULL_ONLY_KEYS.includes(key))).toEqual([]);
    });

    test('a destructive command with dry-run support carries both markers', async () => {
        const wipe = (await briefOf()).commands.find((command) => command.id === 'wipe');

        expect(wipe).toEqual({
            id: 'wipe',
            description: 'Delete the data of an instance',
            destructive: true,
            dryRun: true
        });
    });

    test('a destructive command without dry-run support carries only destructive', async () => {
        const purge = (await briefOf()).commands.find((command) => command.id === 'purge');

        expect(purge).not.toHaveProperty('dryRun');
    });

    test('topics are listed by id with their description', async () => {
        const math = (await briefOf()).topics.find((topic) => topic.id === 'math');

        expect(math?.description).toMatch(/Arithmetic/);
    });

    test('builtins have only an id and a description', async () => {
        const keys = ((await briefOf()).builtins ?? []).flatMap((builtin) => Object.keys(builtin));

        expect(new Set(keys)).toEqual(new Set(['id', 'description']));
    });

    test('more says how to get one command in full', async () => {
        expect((await briefOf()).more).toBe('art help <command> --json');
    });

    test('a topic narrows the brief to its commands and leaves out the builtins', async () => {
        const brief = await briefOf('math');

        expect(brief.commands.map((command) => command.id)).toEqual(['math add', 'math pick']);
        expect(brief).not.toHaveProperty('builtins');
    });

    test('a library run without builtins has no builtins key', async () => {
        const result = envelope(await art(['help', '--json', '--brief'])).result as BriefManifest;

        expect(result).toHaveProperty('commands');
        expect(result).not.toHaveProperty('builtins');
    });
});

describe('help --brief: what it refuses', () => {
    test('one command is a usage error, because it is already the small level', async () => {
        expect((await art(['help', 'hello', '--brief'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('--brief on a command is an unknown flag', async () => {
        expect((await art(['hello', '--brief'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('an unknown word is an unknown command', async () => {
        expect((await art(['help', 'nope', '--brief'])).err).toMatch(/Unknown command/);
    });
});

describe('help --brief: the text', () => {
    test('prints one line per command and marks the destructive ones', async () => {
        const result = await art(['help', '--brief']);

        expect(result.out).toMatch(
            /wipe\s+Delete the data of an instance \(destructive; --dry-run\)/
        );
    });

    test('ends with how to get one command in full', async () => {
        expect((await art(['help', '--brief'])).out).toMatch(/help <command> --json/);
    });
});

describe('help: a command with markers', () => {
    test('its help says it is destructive', async () => {
        expect((await art(['wipe', '--help'])).out).toMatch(/Destructive/);
    });

    test('its help says it supports --dry-run', async () => {
        expect((await art(['wipe', '--help'])).out).toMatch(/Supports --dry-run/);
    });

    test('a command with no markers shows neither note', async () => {
        const run = await art(['hello', '--help']);

        expect(run.code).toBe(EXIT_CODE.OK);
        expect(run.out).toMatch(/Usage/i);
        expect(run.out).not.toMatch(/Destructive|Supports --dry-run/);
    });
});
