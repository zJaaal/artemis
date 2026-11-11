import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import type { Manifest } from '../models.js';
import { art, envelope } from '../test/art.js';

const manifestOf = async (...argv: string[]): Promise<Manifest> =>
    envelope(await art([...argv, '--json'])).result as Manifest;

describe('help: text', () => {
    test('help lists topics and top-level commands with descriptions', async () => {
        const result = await art(['help']);

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.out).toMatch(/math\s+Arithmetic/);
        expect(result.out).toMatch(/hello\s+Greet someone/);
    });

    test('no arguments shows help', async () => {
        const result = await art([]);

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.out).toMatch(/hello/);
    });

    test('naming only a topic lists the commands inside it', async () => {
        const result = await art(['math']);

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.out).toMatch(/math add\s+Add two numbers/);
        expect(result.out).toMatch(/math pick\s+Pick a color/);
    });

    test('"topic help" lists the commands inside the topic', async () => {
        const result = await art(['math', 'help']);

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.out).toMatch(/math add\s+Add two numbers/);
    });

    test('--help on a command shows its args, defaults, choices and flags', async () => {
        const result = await art(['math', 'pick', '--help']);

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.out).toMatch(/art math pick \[color\]/);
        expect(result.out).toMatch(/red, blue/);
        expect(result.out).toMatch(/--tag/);
    });

    test('help for an unknown command is a usage error', async () => {
        const result = await art(['help', 'nope']);

        expect(result.code).toBe(EXIT_CODE.USAGE);
    });

    test('color is applied only when it is on', async () => {
        const result = await art(['help'], { color: true });

        expect(result.out).toContain('\u001b[1m');
    });

    test('without color the text has no escape codes', async () => {
        const result = await art(['help']);

        expect(result.out).not.toContain('\u001b[');
    });
});

describe('help --json: the manifest', () => {
    test('help --json returns a manifest an agent can read', async () => {
        const manifest = await manifestOf('help');
        const add = manifest.commands.find((command) => command.id === 'math add');

        expect(add?.aliases).toEqual(['m:add']);

        expect(add?.args.map((arg) => [arg.name, arg.required])).toEqual([
            ['a', true],
            ['b', true]
        ]);

        expect(manifest.topics.map((topic) => topic.id)).toContain('math');
        expect(manifest.globalFlags.map((flag) => flag.name)).toContain('json');
    });

    test('a command lists name, description, usage, args, flags, defaults, choices and examples', async () => {
        const manifest = await manifestOf('help');
        const hello = manifest.commands.find((command) => command.id === 'hello');

        expect(hello).toEqual({
            id: 'hello',
            description: 'Greet someone',
            usage: 'art hello [name] [flags]',
            aliases: [],
            args: [
                {
                    name: 'name',
                    description: 'Who to greet',
                    required: false,
                    default: 'world',
                    choices: null
                }
            ],
            flags: [
                {
                    name: 'shout',
                    type: 'boolean',
                    short: 's',
                    multiple: false,
                    description: 'Uppercase the greeting',
                    default: null,
                    choices: null
                }
            ],
            examples: []
        });
    });

    test('a choices arg and a repeatable flag are described as data', async () => {
        const manifest = await manifestOf('help');
        const pick = manifest.commands.find((command) => command.id === 'math pick');

        expect(pick).toMatchObject({
            args: [{ name: 'color', default: 'red', choices: ['red', 'blue'] }],
            flags: [{ name: 'tag', type: 'string', multiple: true }]
        });
    });

    test('the manifest keeps its field order', async () => {
        const manifest = await manifestOf('help');
        const [first] = manifest.commands;

        expect(Object.keys(manifest)).toEqual(['bin', 'topics', 'commands', 'globalFlags']);

        expect(Object.keys(first ?? {})).toEqual([
            'id',
            'description',
            'usage',
            'aliases',
            'args',
            'flags',
            'examples'
        ]);
    });

    test('the global flags are part of the manifest', async () => {
        const manifest = await manifestOf('help');

        expect(manifest.globalFlags.map((flag) => [flag.name, flag.short])).toEqual([
            ['help', 'h'],
            ['json', null],
            ['yes', 'y']
        ]);
    });

    test('help for one command is its manifest entry', async () => {
        const result = envelope(await art(['help', 'math', 'add', '--json']));

        expect(result.result).toMatchObject({ id: 'math add', aliases: ['m:add'] });
    });
});
