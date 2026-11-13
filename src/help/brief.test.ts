import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { BUILTINS } from '../cli/constants.js';
import { GLOBAL_FLAGS_TEXT } from '../constants.js';
import type { BriefManifest, Manifest, ManifestCommand } from '../models.js';
import { BRIEF_FIXTURE_MAX_BYTES } from '../test/constants.js';
import { briefListing } from './help.js';
import { art, envelope } from '../test/art.js';

const briefOf = async (...argv: string[]): Promise<BriefManifest> =>
    envelope(await art(['help', ...argv, '--json', '--brief'], { builtins: BUILTINS }))
        .result as BriefManifest;

const FULL_ONLY_KEYS = ['args', 'flags', 'examples', 'aliases'];

describe('help --brief: the JSON', () => {
    test('has the bin, topics, commands, builtins, global flags and the ways to get more', async () => {
        expect(Object.keys(await briefOf())).toEqual([
            'bin',
            'topics',
            'commands',
            'builtins',
            'globalFlags',
            'more',
            'search'
        ]);
    });

    test('states the global flags once, as a line', async () => {
        expect((await briefOf()).globalFlags).toBe(GLOBAL_FLAGS_TEXT);
    });

    test('the global flags line is the long names in declared order, with a file for --log', () => {
        expect(GLOBAL_FLAGS_TEXT).toBe('--help --json --yes --dry-run --quiet --log <file>');
    });

    test('search says how to search by intent', async () => {
        expect((await briefOf()).search).toBe('art help --search <words> --json');
    });

    test('a command entry has only id, description and usage when it marks nothing', async () => {
        const hello = (await briefOf()).commands.find((command) => command.id === 'hello');

        expect(hello).toEqual({
            id: 'hello',
            description: 'Greet someone',
            usage: 'hello [name] [--shout]'
        });
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
            usage: 'wipe',
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

    test('builtins are a list of ids', async () => {
        expect((await briefOf()).builtins).toEqual(BUILTINS.map((builtin) => builtin.id));
    });

    test('a topic has the number of commands under it', async () => {
        const math = (await briefOf()).topics.find((topic) => topic.id === 'math');

        expect(math?.commands).toBe(2);
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

describe('briefListing: topics and size', () => {
    const entry = (id: string): ManifestCommand => ({
        id,
        description: id,
        usage: id,
        args: [],
        flags: []
    });

    const everything: Manifest = {
        bin: 'art',
        topics: [
            { id: 'db', description: '' },
            { id: 'ci', description: 'Continuous integration' }
        ],
        commands: [entry('db reset'), entry('db seed'), entry('ci run')],
        globalFlags: []
    };

    test('a topic with no description has no description key', () => {
        const db = briefListing(everything).brief.topics.find((topic) => topic.id === 'db');

        expect(db).toEqual({ id: 'db', commands: 2 });
    });

    test('a topic with a description keeps it, with its count', () => {
        const ci = briefListing(everything).brief.topics.find((topic) => topic.id === 'ci');

        expect(ci).toEqual({ id: 'ci', description: 'Continuous integration', commands: 1 });
    });

    test('the brief listing of the fixture project stays under its byte limit', async () => {
        const result = await art(['help', '--json', '--brief'], { builtins: BUILTINS });

        expect(Buffer.byteLength(result.out)).toBeLessThan(BRIEF_FIXTURE_MAX_BYTES);
    });
});

describe('help --brief: the text of the topics', () => {
    test('a topic line has its description and its count', async () => {
        expect((await art(['help', '--brief'])).out).toMatch(/math\s+Arithmetic.*\(2 commands\)/);
    });

    test('the built-in words keep their descriptions in text', async () => {
        const out = (await art(['help', '--brief'], { builtins: BUILTINS })).out;

        expect(out).toMatch(/Built-in\n\s+init\s+Make the current folder a project/);
    });
});
