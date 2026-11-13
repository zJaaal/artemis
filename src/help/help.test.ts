import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import type { Manifest } from '../models.js';
import { BUILTINS } from '../cli/constants.js';
import { discover } from '../discover/discover.js';
import { COMMANDS_FIXTURE_DIR } from '../test/constants.js';
import { art, envelope } from '../test/art.js';
import { briefManifest, describeBuiltins, manifest, rootHelp, topicManifest } from './help.js';
import { createStyle } from './help.js';

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
    test('help <topic> --json lists only the commands under that topic', async () => {
        const manifest = await manifestOf('help', 'math');

        expect(manifest.commands.map((command) => command.id)).toEqual(
            expect.arrayContaining(['math add'])
        );

        expect(manifest.commands.every((command) => command.id.startsWith('math '))).toBe(true);
    });

    test('help <topic> --json leaves out the other topics', async () => {
        const manifest = await manifestOf('help', 'math');

        expect(manifest.topics.map((topic) => topic.id)).toEqual(['math']);
    });

    test('help <topic> --json keeps the shape of the whole manifest', async () => {
        const manifest = await manifestOf('help', 'math');

        expect(Object.keys(manifest)).toEqual(['bin', 'topics', 'commands', 'globalFlags']);
    });

    test('<topic> --help --json gives the same manifest as help <topic> --json', async () => {
        expect(await manifestOf('math', '--help')).toEqual(await manifestOf('help', 'math'));
    });

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
            args: [{ name: 'name', description: 'Who to greet', default: 'world' }],
            flags: [
                {
                    name: 'shout',
                    type: 'boolean',
                    short: 's',
                    description: 'Uppercase the greeting'
                }
            ]
        });
    });

    test('a destructive command with dry-run support says so in the manifest', async () => {
        const manifest = await manifestOf('help');

        expect(manifest.commands.find((command) => command.id === 'wipe')).toMatchObject({
            destructive: true,
            dryRun: true
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

        expect(Object.keys(manifest)).toEqual(['bin', 'topics', 'commands', 'globalFlags']);
    });

    test('an entry with every default has only id, description, usage, args and flags', async () => {
        const manifest = await manifestOf('help');
        const hello = manifest.commands.find((command) => command.id === 'hello');

        expect(Object.keys(hello ?? {})).toEqual(['id', 'description', 'usage', 'args', 'flags']);
    });

    test('a command with aliases has the aliases key between usage and args', async () => {
        const manifest = await manifestOf('help');
        const add = manifest.commands.find((command) => command.id === 'math add');

        expect(Object.keys(add ?? {})).toEqual([
            'id',
            'description',
            'usage',
            'aliases',
            'args',
            'flags'
        ]);
    });

    test('a built-in with examples has the examples key after flags', () => {
        const state = describeBuiltins('art', BUILTINS).find((builtin) => builtin.id === 'state');

        expect(Object.keys(state ?? {}).slice(-2)).toEqual(['flags', 'examples']);
    });

    test('a destructive command with dry-run support has both keys after the examples', async () => {
        const manifest = await manifestOf('help');
        const wipe = manifest.commands.find((command) => command.id === 'wipe');

        expect(Object.keys(wipe ?? {}).slice(-2)).toEqual(['destructive', 'dryRun']);
    });

    test('an arg with a default and choices, and a repeatable flag, carry those keys', async () => {
        const manifest = await manifestOf('help');
        const pick = manifest.commands.find((command) => command.id === 'math pick');

        expect(Object.keys(pick?.args[0] ?? {})).toEqual([
            'name',
            'description',
            'default',
            'choices'
        ]);

        expect(Object.keys(pick?.flags[0] ?? {})).toEqual([
            'name',
            'type',
            'multiple',
            'description'
        ]);
    });

    test('a required arg says required: true', async () => {
        const manifest = await manifestOf('help');
        const add = manifest.commands.find((command) => command.id === 'math add');

        expect(add?.args[0]).toHaveProperty('required', true);
    });

    test('the global flags are part of the manifest', async () => {
        const manifest = await manifestOf('help');

        expect(manifest.globalFlags.map((flag) => [flag.name, flag.short])).toEqual([
            ['help', 'h'],
            ['json', undefined],
            ['yes', 'y'],
            ['dry-run', undefined],
            ['quiet', undefined],
            ['log', undefined]
        ]);
    });

    test('help for one command is its manifest entry', async () => {
        const result = envelope(await art(['help', 'math', 'add', '--json']));

        expect(result.result).toMatchObject({ id: 'math add', aliases: ['m:add'] });
    });
});

describe('help: the binary’s own words', () => {
    const style = createStyle(false);

    test('a run without builtins lists no Built-in section', async () => {
        expect((await art(['help'])).out).not.toContain('Built-in');
    });

    test('a run without builtins has no builtins key in its manifest', async () => {
        expect(Object.keys(await manifestOf('help'))).not.toContain('builtins');
    });

    test('a run given builtins lists them under Built-in', async () => {
        const result = await art(['help'], { builtins: BUILTINS });

        expect(result.out).toMatch(
            /Built-in\n\s+init\s+Make the current folder a project\n\s+state\s+/
        );
    });

    test('Built-in comes after Commands', async () => {
        const { out } = await art(['help'], { builtins: BUILTINS });

        expect(out.indexOf('Built-in')).toBeGreaterThan(out.indexOf('Commands'));
    });

    test('Built-in comes before the global flags', async () => {
        const { out } = await art(['help'], { builtins: BUILTINS });

        expect(out.indexOf('Built-in')).toBeLessThan(out.indexOf('Global flags'));
    });

    test('a topic lists no Built-in section even in a run that has builtins', async () => {
        expect((await art(['math'], { builtins: BUILTINS })).out).not.toContain('Built-in');
    });

    test('help --json adds a builtins array with init and state', async () => {
        const result = envelope(await art(['help', '--json'], { builtins: BUILTINS }));

        expect((result.result as Manifest).builtins?.map((builtin) => builtin.id)).toEqual([
            'init',
            'state',
            'skill',
            'doctor'
        ]);
    });

    test('every builtin has the shape of a command entry', async () => {
        const result = envelope(await art(['help', '--json'], { builtins: BUILTINS }));
        const [first] = (result.result as Manifest).builtins ?? [];

        expect(Object.keys(first ?? {})).toEqual([
            'id',
            'description',
            'usage',
            'args',
            'flags',
            'examples'
        ]);
    });

    test('every existing field of the manifest keeps its name and place', async () => {
        const result = envelope(await art(['help', '--json'], { builtins: BUILTINS }));

        expect(Object.keys(result.result as Manifest)).toEqual([
            'bin',
            'topics',
            'commands',
            'globalFlags',
            'builtins'
        ]);
    });

    test('the fields other than builtins are the same as without builtins', async () => {
        const without = envelope(await art(['help', '--json'])).result as Manifest;

        const given = envelope(await art(['help', '--json'], { builtins: BUILTINS }))
            .result as Manifest;

        expect({
            bin: given.bin,
            topics: given.topics,
            commands: given.commands,
            globalFlags: given.globalFlags
        }).toEqual(without);
    });

    test('help <topic> --json does not carry builtins', async () => {
        const result = envelope(await art(['help', 'math', '--json'], { builtins: BUILTINS }));

        expect(Object.keys(result.result as Manifest)).toEqual([
            'bin',
            'topics',
            'commands',
            'globalFlags'
        ]);
    });

    test('help state prints the usage of the built-in word', async () => {
        const result = await art(['help', 'state'], { builtins: BUILTINS });

        expect([result.code, result.out]).toEqual([
            EXIT_CODE.OK,
            expect.stringContaining('art state [doc] [flags]')
        ]);
    });

    test('help init prints its description', async () => {
        const { out } = await art(['help', 'init'], { builtins: BUILTINS });

        expect(out).toContain('Make the current folder a project');
    });

    test('help state shows the --reset flag and its examples', async () => {
        const { out } = await art(['help', 'state'], { builtins: BUILTINS });

        expect(out).toContain('--reset');
        expect(out).toContain('art state steps --reset --yes');
    });

    test('help state --json is the entry of state, shaped like a command', async () => {
        const result = envelope(await art(['help', 'state', '--json'], { builtins: BUILTINS }));

        expect(result).toMatchObject({
            ok: true,
            command: 'state',
            result: { id: 'state', usage: 'art state [doc] [flags]' }
        });
    });

    test('help state is an unknown command in a run without builtins', async () => {
        expect((await art(['help', 'state'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('an unknown command close to a built-in suggests it', async () => {
        const result = await art(['stat'], { builtins: BUILTINS });

        expect(result.err).toMatch(/Did you mean "state"/);
    });

    test('a run without builtins never suggests one', async () => {
        const result = await art(['stat']);

        expect(result.err).not.toMatch(/Did you mean "state"/);
    });

    test('state is described with its document argument and its --reset flag', () => {
        const described = describeBuiltins('art', BUILTINS).find(
            (builtin) => builtin.id === 'state'
        );

        expect(described).toMatchObject({
            usage: 'art state [doc] [flags]',
            args: [{ name: 'doc' }],
            flags: [{ name: 'reset', type: 'boolean' }]
        });
    });

    test('init is described with no arguments and no flags of its own', () => {
        const described = describeBuiltins('art', BUILTINS).find(
            (builtin) => builtin.id === 'init'
        );

        expect(described).toMatchObject({ usage: 'art init', args: [], flags: [] });
    });

    test('a manifest built with no builtins argument has no builtins key at all', async () => {
        const registry = await discover(COMMANDS_FIXTURE_DIR);

        expect('builtins' in manifest('art', registry)).toBe(false);
    });

    test('the root help text has no Built-in section when it is given none', async () => {
        const registry = await discover(COMMANDS_FIXTURE_DIR);

        expect(rootHelp('art', registry, style)).not.toContain('Built-in');
    });

    test('narrowing a manifest to a topic drops its builtins', async () => {
        const registry = await discover(COMMANDS_FIXTURE_DIR);
        const narrowed = topicManifest(manifest('art', registry, BUILTINS), 'math');

        expect('builtins' in narrowed).toBe(false);
    });
});

describe('briefManifest: a nested topic', () => {
    const command = (id: string) => ({
        id,
        description: id,
        usage: id,
        args: [],
        flags: []
    });

    const everything: Manifest = {
        bin: 'art',
        topics: [
            { id: 'dotcms', description: 'dotCMS' },
            { id: 'dotcms db', description: 'Database' }
        ],
        commands: [command('dotcms start'), command('dotcms db dump')],
        globalFlags: []
    };

    test('does not list the topics above the one asked for', () => {
        expect(briefManifest(everything, 'dotcms db').topics.map((topic) => topic.id)).toEqual([
            'dotcms db'
        ]);
    });

    test('lists the topic asked for and the ones below it', () => {
        expect(briefManifest(everything, 'dotcms').topics.map((topic) => topic.id)).toEqual([
            'dotcms',
            'dotcms db'
        ]);
    });
});
