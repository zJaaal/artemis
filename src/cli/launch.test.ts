import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import type { Manifest } from '../models.js';
import type { Envelope } from '../test/models.js';
import { makeProject } from '../test/project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { cli } from './index.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

/** Runs the shipped command as if typed in `cwd`. */
const art = async (argv: string[], cwd: string) => {
    const stdout = createSink();
    const stderr = createSink();

    const code = await cli({
        argv,
        cwd,
        stdout,
        stderr,
        env: {},
        interactive: false,
        color: false
    });

    return { code, out: stdout.text, err: stderr.text };
};

const envelope = (out: string): Envelope => JSON.parse(out) as Envelope;

const greeting = async (cwd: string): Promise<unknown> =>
    envelope((await art(['hello', '--json'], cwd)).out).result;

describe('cli: which project it runs', () => {
    test('runs the commands folder of the project it is run in, with no bin file', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project' });

        expect(await greeting(root)).toEqual({ greeting: 'project' });
    });

    test('runs it from a folder deep inside the project', async () => {
        const root = folders.make('artemis-cli-');
        const deep = path.join(root, 'src', 'deep');

        makeProject(root, { greeting: 'project' });
        fs.mkdirSync(deep, { recursive: true });

        expect(await greeting(deep)).toEqual({ greeting: 'project' });
    });

    test('in a monorepo, the nearest package that is a project wins', async () => {
        const root = folders.make('artemis-cli-');
        const inner = path.join(root, 'packages', 'inner');

        makeProject(root, { greeting: 'outer' });
        makeProject(inner, { greeting: 'inner' });

        expect(await greeting(path.join(inner, 'src'))).toEqual({ greeting: 'inner' });
    });

    test('a monorepo package with no commands and no key uses the root’s commands', async () => {
        const root = folders.make('artemis-cli-');
        const inner = path.join(root, 'packages', 'inner');

        makeProject(root, { greeting: 'outer' });
        fs.mkdirSync(inner, { recursive: true });
        fs.writeFileSync(path.join(inner, 'package.json'), '{ "name": "inner" }');

        expect(await greeting(inner)).toEqual({ greeting: 'outer' });
    });

    test('a package that declares itself with an artemis key but has no commands fails about its own', async () => {
        const root = folders.make('artemis-cli-');
        const inner = path.join(root, 'packages', 'inner');

        makeProject(root, { greeting: 'outer' });
        fs.mkdirSync(inner, { recursive: true });

        fs.writeFileSync(
            path.join(inner, 'package.json'),
            JSON.stringify({ name: 'inner', artemis: {} })
        );

        const result = await art(['hello', '--json'], inner);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            error: `Commands folder not found: ${path.join(inner, 'commands')}`,
            hint: expect.stringContaining(
                'If the commands live in a parent folder, point commandsDir at them'
            )
        });
    });

    test('a template package.json, even valid JSON with a name, does not stop the search', async () => {
        const root = folders.make('artemis-cli-');
        const templates = path.join(root, 'templates');

        makeProject(root, { greeting: 'project' });
        fs.mkdirSync(templates);
        fs.writeFileSync(path.join(templates, 'package.json'), '{ "name": "{{name}}" }');

        expect(await greeting(templates)).toEqual({ greeting: 'project' });
    });

    test('a marker with extra keys, such as sideEffects, does not stop the search either', async () => {
        const root = folders.make('artemis-cli-');
        const esm = path.join(root, 'dist', 'esm');

        makeProject(root, { greeting: 'project' });
        fs.mkdirSync(esm, { recursive: true });

        fs.writeFileSync(
            path.join(esm, 'package.json'),
            '{ "type": "module", "sideEffects": false }'
        );

        expect(await greeting(esm)).toEqual({ greeting: 'project' });
    });

    test('an unnamed monorepo root with a commands folder is the project', async () => {
        const root = folders.make('artemis-cli-');
        const commands = makeProject(root, { greeting: 'root' });

        fs.writeFileSync(path.join(root, 'package.json'), '{ "private": true }');

        expect(commands).toBe(path.join(root, 'commands'));
        expect(await greeting(root)).toEqual({ greeting: 'root' });
    });

    test('a type marker package.json inside src does not stop the search', async () => {
        const root = folders.make('artemis-cli-');
        const src = path.join(root, 'src');

        makeProject(root, { greeting: 'project' });
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, 'package.json'), '{ "type": "module" }');

        expect(await greeting(src)).toEqual({ greeting: 'project' });
    });

    test('two projects on one machine run only their own commands', async () => {
        const work = folders.make('artemis-cli-');

        makeProject(path.join(work, 'a'), { greeting: 'a' });
        makeProject(path.join(work, 'b'), { greeting: 'b' });

        expect([
            await greeting(path.join(work, 'a')),
            await greeting(path.join(work, 'b'))
        ]).toEqual([{ greeting: 'a' }, { greeting: 'b' }]);
    });

    test('"artemis".commandsDir moves the commands folder', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, {
            greeting: 'moved',
            manifest: { artemis: { commandsDir: 'tools/commands' } },
            commandsFolder: 'tools/commands'
        });

        expect(await greeting(root)).toEqual({ greeting: 'moved' });
    });

    test('exits with the code of the command line it ran', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project' });

        expect((await art(['nope'], root)).code).toBe(EXIT_CODE.USAGE);
    });
});

describe('cli: the name it shows', () => {
    const manifestOf = async (cwd: string) =>
        envelope((await art(['help', '--json'], cwd)).out).result as Manifest;

    test('is art by default', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project' });

        expect((await manifestOf(root)).bin).toBe('art');
    });

    test('is the "artemis".bin setting when there is one', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project', manifest: { artemis: { bin: 'mytool' } } });

        expect((await manifestOf(root)).bin).toBe('mytool');
    });

    test('is art even when the project publishes an unrelated CLI of its own', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project', manifest: { bin: { foo: 'bin/foo.js' } } });

        expect((await manifestOf(root)).bin).toBe('art');
    });

    test('shows up in the usage lines of the text help', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project', manifest: { artemis: { bin: 'mytool' } } });

        expect((await art(['help'], root)).out).toContain('mytool <topic> <command>');
    });
});

describe('cli: the built-in words in help', () => {
    const manifestOf = async (cwd: string) =>
        envelope((await art(['help', '--json'], cwd)).out).result as Manifest;

    test('the shipped binary lists init and state in the builtins of its manifest', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project' });

        expect((await manifestOf(root)).builtins?.map((builtin) => builtin.id)).toEqual([
            'init',
            'state'
        ]);
    });

    test('the shipped binary lists them under Built-in in its text help', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project' });

        expect((await art(['help'], root)).out).toMatch(/Built-in\n\s+init\s+.*\n\s+state\s+/);
    });

    test('the usage lines of the builtins show the name of the binary', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project', manifest: { artemis: { bin: 'mytool' } } });

        expect((await manifestOf(root)).builtins?.map((builtin) => builtin.usage)).toEqual([
            'mytool init',
            'mytool state [doc] [flags]'
        ]);
    });

    test('a published tool’s manifest has no builtins key', async () => {
        const tool = folders.make('artemis-tool-');

        makeProject(tool, {
            greeting: 'tool',
            manifest: { name: 'mytool', bin: { mytool: 'bin/mytool.js' } }
        });

        const stdout = createSink();

        await cli({
            argv: ['help', '--json'],
            root: path.join(tool, 'bin', 'mytool.js'),
            stdout,
            stderr: createSink(),
            env: {},
            interactive: false
        });

        expect(Object.keys(envelope(stdout.text).result as Manifest)).not.toContain('builtins');
    });

    test('a published tool’s text help has no Built-in section', async () => {
        const tool = folders.make('artemis-tool-');

        makeProject(tool, {
            greeting: 'tool',
            manifest: { name: 'mytool', bin: { mytool: 'bin/mytool.js' } }
        });

        const stdout = createSink();

        await cli({
            argv: ['help'],
            root: path.join(tool, 'bin', 'mytool.js'),
            stdout,
            stderr: createSink(),
            env: {},
            interactive: false,
            color: false
        });

        expect(stdout.text).not.toContain('Built-in');
    });
});

describe('cli: when it cannot find what to run', () => {
    test('with no project up the tree it fails and says what to create', async () => {
        const nowhere = folders.make('artemis-cli-');
        const result = await art(['hello'], nowhere);

        expect(result.code).toBe(EXIT_CODE.FAILED);
        expect(result.err).toContain(`No project found from ${nowhere} upwards`);
        expect(result.err).toContain('use its "init" command in this folder to create one');
    });

    test('a package.json with neither an artemis key nor a commands folder is not a project', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "app", "version": "1.0.0" }');

        expect((await art(['hello'], root)).err).toContain(`No project found from ${root} upwards`);
    });

    test('a package.json with an artemis key and no commands folder is the project, and says so', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "empty", "artemis": {} }');

        expect((await art(['hello'], root)).err).toContain(
            `Commands folder not found: ${path.join(root, 'commands')}`
        );
    });

    test('the hint names no binary, because it is not known what the user typed', async () => {
        const nowhere = folders.make('artemis-cli-');
        const result = await art(['hello', '--json'], nowhere);

        expect(envelope(result.out).hint).not.toMatch(/\bart\b/);
    });

    test('under --json that is one object with a null command', async () => {
        const nowhere = folders.make('artemis-cli-');
        const result = await art(['hello', '--json'], nowhere);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: `No project found from ${nowhere} upwards`,
            hint: expect.stringContaining('use its "init" command in this folder to create one')
        });

        expect(result.err).toBe('');
    });

    test('a project with no commands folder says which folder to create, and where else to point', async () => {
        const root = folders.make('artemis-cli-');
        const manifestPath = path.join(root, 'package.json');

        fs.writeFileSync(manifestPath, JSON.stringify({ name: 'empty', artemis: {} }));

        const result = await art(['hello', '--json'], root);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: `Commands folder not found: ${path.join(root, 'commands')}`,
            hint:
                `Create ${path.join(root, 'commands')}, or set "artemis": { "commandsDir" } in ${manifestPath}. ` +
                'If the commands live in a parent folder, point commandsDir at them, for example "../commands".'
        });
    });

    test('a bad "artemis" key fails and names the field', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project', manifest: { artemis: { commandsDir: 5 } } });

        const result = await art(['hello', '--json'], root);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: `"artemis".commandsDir must be a non-empty string (in ${path.join(root, 'package.json')})`
        });
    });

    test('a package.json that is not valid JSON fails and names the file, when it is the project', async () => {
        const root = folders.make('artemis-cli-');

        fs.mkdirSync(path.join(root, 'commands'));
        fs.writeFileSync(path.join(root, 'package.json'), '{ nope');

        expect((await art(['hello'], root)).err).toContain(
            `${path.join(root, 'package.json')} is not valid JSON`
        );
    });

    test('a template package.json that is not valid JSON is an error, never skipped for the project above it', async () => {
        const root = folders.make('artemis-cli-');
        const templates = path.join(root, 'templates');

        makeProject(root, { greeting: 'project' });
        fs.mkdirSync(templates);
        fs.writeFileSync(path.join(templates, 'package.json'), '{ "name": "{{name}}", }');

        const result = await art(['hello', '--json'], templates);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: expect.stringContaining(
                `${path.join(templates, 'package.json')} is not valid JSON`
            )
        });
    });

    test('a monorepo package with a trailing comma in its package.json fails instead of running the root’s command', async () => {
        const root = folders.make('artemis-cli-');
        const inner = path.join(root, 'packages', 'inner');

        makeProject(root, { greeting: 'root' });
        fs.mkdirSync(path.join(inner, 'tools'), { recursive: true });

        fs.writeFileSync(
            path.join(inner, 'package.json'),
            '{ "name": "inner", "artemis": { "commandsDir": "tools" }, }'
        );

        const result = await art(['hello', '--json'], inner);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: expect.stringContaining(`${path.join(inner, 'package.json')} is not valid JSON`)
        });
    });

    test('a package.json that cannot be read fails and names the file, with no stack trace', async () => {
        const root = folders.make('artemis-cli-');

        fs.mkdirSync(path.join(root, 'package.json'));

        const result = await art(['hello'], root);

        expect(result.err).toContain(`Cannot read ${path.join(root, 'package.json')}`);
        expect(result.err).not.toMatch(/\s+at /);
    });
});

/** A published tool's package.json: it declares the bin that npm links, which is how it is found. */
const TOOL_PACKAGE = '{ "name": "mytool", "bin": { "mytool": "bin/mytool.js" } }';

describe('cli: a project’s own bin file', () => {
    /** Runs `cli({ root })` the way a published tool's bin file does, from an unrelated folder. */
    const ownArt = async (argv: string[], root: string | URL) => {
        const stdout = createSink();
        const stderr = createSink();

        const code = await cli({
            argv,
            root,
            stdout,
            stderr,
            env: {},
            interactive: false,
            color: false
        });

        return { code, out: stdout.text, err: stderr.text };
    };

    const makeTool = () => {
        const toolRoot = folders.make('artemis-tool-');
        const binFile = path.join(toolRoot, 'bin', 'mytool.js');

        makeProject(toolRoot, {
            greeting: 'tool',
            manifest: { name: 'mytool', bin: { mytool: 'bin/mytool.js' } }
        });

        return { toolRoot, binFile };
    };

    test('runs the project the bin file belongs to, from a file URL', async () => {
        const { binFile } = makeTool();
        const result = await ownArt(['hello', '--json'], pathToFileURL(binFile).href);

        expect(envelope(result.out).result).toEqual({ greeting: 'tool' });
    });

    test('accepts a plain path and a URL object as well', async () => {
        const { binFile } = makeTool();

        const results = [
            await ownArt(['hello', '--json'], binFile),
            await ownArt(['hello', '--json'], pathToFileURL(binFile))
        ];

        expect(results.map((result) => envelope(result.out).result)).toEqual([
            { greeting: 'tool' },
            { greeting: 'tool' }
        ]);
    });

    test('does not look at the project of the current folder', async () => {
        const { binFile } = makeTool();
        const elsewhere = folders.make('artemis-cli-');

        makeProject(elsewhere, { greeting: 'elsewhere' });

        const result = await cli({
            argv: ['hello', '--json'],
            root: binFile,
            cwd: elsewhere,
            stdout: createSink(),
            env: {}
        });

        expect(result).toBe(EXIT_CODE.OK);
    });

    test('shows the name of its own bin field', async () => {
        const { binFile } = makeTool();
        const result = await ownArt(['help', '--json'], binFile);

        expect((envelope(result.out).result as Manifest).bin).toBe('mytool');
    });

    test('shows the package name when bin is a plain string', async () => {
        const toolRoot = folders.make('artemis-tool-');

        makeProject(toolRoot, {
            greeting: 'tool',
            manifest: { name: '@acme/mytool', bin: 'bin/mytool.js' }
        });

        const result = await ownArt(['help', '--json'], path.join(toolRoot, 'bin', 'mytool.js'));

        expect((envelope(result.out).result as Manifest).bin).toBe('mytool');
    });

    test('a bin file with no package.json around it fails with a hint for the tool’s author', async () => {
        const nowhere = folders.make('artemis-tool-');
        const result = await ownArt(['hello', '--json'], path.join(nowhere, 'bin', 'mytool.js'));

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: expect.stringContaining('with a "bin" field found from'),
            hint: expect.stringContaining('If you maintain this tool')
        });
    });

    test('a tool whose bin file is in dist, next to a type marker package.json, still finds its own package', async () => {
        const toolRoot = folders.make('artemis-tool-');
        const dist = path.join(toolRoot, 'dist');

        makeProject(toolRoot, {
            greeting: 'tool',
            manifest: { name: 'mytool', bin: { mytool: 'dist/bin.js' } }
        });

        fs.mkdirSync(dist);

        fs.writeFileSync(
            path.join(dist, 'package.json'),
            '{ "type": "module", "sideEffects": false }'
        );

        const result = await ownArt(['hello', '--json'], path.join(dist, 'bin.js'));

        expect(envelope(result.out).result).toEqual({ greeting: 'tool' });
    });

    test('a tool that does not ship its commands never runs the commands of the project that installed it', async () => {
        const user = folders.make('artemis-cli-');
        const tool = path.join(user, 'node_modules', 'mytool');

        makeProject(user, { greeting: 'the user' });
        fs.mkdirSync(path.join(tool, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(tool, 'package.json'), TOOL_PACKAGE);

        const result = await ownArt(['hello', '--json'], path.join(tool, 'bin', 'mytool.js'));

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: `Commands folder not found: ${path.join(tool, 'commands')}`
        });
    });

    test('a tool that declares no bin never climbs into the project that holds it', async () => {
        const host = folders.make('artemis-cli-');
        const tool = path.join(host, 'packages', 'mytool');

        makeProject(host, {
            greeting: 'the host',
            manifest: { name: 'host', bin: { host: 'bin/host.js' } }
        });

        fs.mkdirSync(path.join(tool, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(tool, 'package.json'), '{ "name": "mytool" }');

        const result = await ownArt(['hello', '--json'], path.join(tool, 'bin', 'mytool.js'));

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            error: `Commands folder not found: ${path.join(tool, 'commands')}`
        });
    });

    test('an installed package with no name, bin or key is still its own package', async () => {
        const user = folders.make('artemis-cli-');
        const tool = path.join(user, 'node_modules', 'mytool');

        makeProject(user, {
            greeting: 'the user',
            manifest: { name: 'user', bin: { user: 'bin/u.js' } }
        });

        fs.mkdirSync(path.join(tool, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(tool, 'package.json'), '{ "private": true }');

        const result = await ownArt(['hello', '--json'], path.join(tool, 'bin', 'mytool.js'));

        expect(envelope(result.out).error).toBe(
            `Commands folder not found: ${path.join(tool, 'commands')}`
        );
    });

    test('an unnamed private tool without commands never runs the commands of the project that installed it', async () => {
        const user = folders.make('artemis-cli-');
        const tool = path.join(user, 'node_modules', 'mytool');

        makeProject(user, { greeting: 'the user' });
        fs.mkdirSync(path.join(tool, 'bin'), { recursive: true });

        fs.writeFileSync(
            path.join(tool, 'package.json'),
            '{ "private": true, "bin": { "mytool": "bin/mytool.js" } }'
        );

        const result = await ownArt(['hello', '--json'], path.join(tool, 'bin', 'mytool.js'));

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            error: `Commands folder not found: ${path.join(tool, 'commands')}`
        });
    });

    test('the failure of a tool without commands tells its author what to ship', async () => {
        const tool = folders.make('artemis-tool-');

        fs.writeFileSync(path.join(tool, 'package.json'), TOOL_PACKAGE);

        const result = await ownArt(['hello', '--json'], path.join(tool, 'bin', 'mytool.js'));

        expect(envelope(result.out).hint).toContain('its author has to ship the commands folder');
    });

    test('a published tool is never told to point its commands at another package', async () => {
        const tool = folders.make('artemis-tool-');

        fs.writeFileSync(path.join(tool, 'package.json'), TOOL_PACKAGE);

        const result = await ownArt(['hello', '--json'], path.join(tool, 'bin', 'mytool.js'));

        expect(envelope(result.out).hint).not.toContain('parent folder');
    });

    test('the parent-folder advice is not given when commandsDir already points outside the project', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ name: 'app', artemis: { commandsDir: '../commands' } })
        );

        const result = await art(['hello', '--json'], root);

        expect(envelope(result.out).hint).not.toContain('parent folder');
    });

    test('the parent-folder advice is given when commandsDir stays inside the project', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ name: 'app', artemis: {} })
        );

        const result = await art(['hello', '--json'], root);

        expect(envelope(result.out).hint).toContain(
            'point commandsDir at them, for example "../commands"'
        );
    });

    test('a commands folder whose name merely starts with two dots is still inside the project', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ name: 'app', artemis: { commandsDir: '..cmds' } })
        );

        const result = await art(['hello', '--json'], root);

        expect(envelope(result.out).hint).toContain('point commandsDir at them');
    });

    test('the same failure for the shipped route does not blame an author', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ artemis: {} }));

        const result = await art(['hello', '--json'], root);

        expect(envelope(result.out).hint).not.toContain('author');
    });

    test('a tool with several bin names is called after its package', async () => {
        const toolRoot = folders.make('artemis-tool-');

        makeProject(toolRoot, {
            greeting: 'tool',
            manifest: { name: '@acme/mytool', bin: { mytool: 'bin/mytool.js', mt: 'bin/mt.js' } }
        });

        const result = await ownArt(['help', '--json'], path.join(toolRoot, 'bin', 'mytool.js'));

        expect((envelope(result.out).result as Manifest).bin).toBe('mytool');
    });

    test('a root that is not a file URL or a path is a reported failure, not a crash', async () => {
        const result = await ownArt(['hello', '--json'], 'http://example.com/bin/mytool.js');

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: expect.stringContaining(
                'cli({ root }) needs the location of your bin file, but got http://example.com/bin/mytool.js ('
            ),
            hint: 'Pass import.meta.url from your bin file, or a path.'
        });
    });

    test('a bad root keeps the reason Node gave, so the real problem is visible', async () => {
        const result = await ownArt(['hello', '--json'], 'http://example.com/bin/mytool.js');

        expect(envelope(result.out).error).toMatch(/ \(.*(scheme|file).*\)$/i);
    });

    test('an empty root is a reported failure too', async () => {
        const result = await ownArt(['hello'], '');

        expect(result.code).toBe(EXIT_CODE.FAILED);
        expect(result.err).toContain('cli({ root }) needs the location of your bin file');
    });

    test('a bad root prints no stack trace', async () => {
        const result = await ownArt(['hello'], new URL('http://example.com/x'));

        expect(result.err).not.toMatch(/\s+at /);
    });
});

describe('cli: the init word of the shipped binary', () => {
    test('makes the current folder a project and says what it created', async () => {
        const dir = folders.make('artemis-cli-');
        const result = await art(['init'], dir);

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.out).toContain(`Created ${path.join(dir, 'package.json')}`);
        expect(result.out).toContain(`Created ${path.join(dir, 'commands', 'hello.js')}`);
    });

    test('under --json it prints one object with what it created', async () => {
        const dir = folders.make('artemis-cli-');
        const result = await art(['init', '--json'], dir);

        expect(envelope(result.out)).toMatchObject({
            ok: true,
            command: 'init',
            result: { root: dir, created: expect.arrayContaining([path.join(dir, 'package.json')]) }
        });
    });

    test('takes no folder: a project is made where you are, so it asks you to go there first', async () => {
        const dir = folders.make('artemis-cli-');
        const result = await art(['init', 'sub', '--json'], dir);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            error: 'init takes no arguments, but got "sub"',
            hint: 'Go to the folder you want to make a project, then run it.'
        });

        expect(fs.existsSync(path.join(dir, 'sub'))).toBe(false);
    });

    test('a flag that is not global before the word is a usage error (exit 2)', async () => {
        const result = await art(['--reset', 'init', '--json'], folders.make('artemis-cli-'));

        expect(result.code).toBe(EXIT_CODE.USAGE);
    });

    test('--help --json is one object holding the manifest entry of init', async () => {
        const result = await art(['init', '--help', '--json'], folders.make('artemis-cli-'));

        expect(envelope(result.out)).toMatchObject({
            ok: true,
            command: 'init',
            result: { id: 'init', aliases: [], args: [], flags: [] }
        });
    });

    test('plain --help is still the usage text', async () => {
        const result = await art(['init', '--help'], folders.make('artemis-cli-'));

        expect(result.out).toContain('Usage: init [--quiet] [--json]');
    });

    test('a global flag before the word works too', async () => {
        const dir = folders.make('artemis-cli-');
        const result = await art(['--json', 'init'], dir);

        expect(envelope(result.out)).toMatchObject({ ok: true, command: 'init' });
    });

    test('in a folder that already is a project it changes nothing and says so', async () => {
        const dir = folders.make('artemis-cli-');

        await art(['init'], dir);

        const again = await art(['init'], dir);

        expect(again.out).toContain('Already a project: nothing to create.');
    });

    test('a project becomes runnable at once: init, then hello', async () => {
        const dir = folders.make('artemis-cli-');

        await art(['init'], dir);

        expect(await greeting(dir)).toEqual({ greeting: 'hello world' });
    });

    test('an option it does not know is a usage error (exit 2)', async () => {
        const result = await art(['init', '--bogus', '--json'], folders.make('artemis-cli-'));

        expect(result.code).toBe(EXIT_CODE.USAGE);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            error: 'init takes no arguments, but got "--bogus"'
        });
    });

    test('--yes means nothing to a word that never asks, so it is a usage error too', async () => {
        const result = await art(['init', '--yes'], folders.make('artemis-cli-'));

        expect(result.code).toBe(EXIT_CODE.USAGE);
        expect(result.err).toContain('init takes no arguments, but got "--yes"');
    });

    test('--help prints how to use it, and creates nothing', async () => {
        const dir = folders.make('artemis-cli-');
        const result = await art(['init', '--help'], dir);

        expect(result.out).toContain('Usage: init [--quiet] [--json]');
        expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(false);
    });

    test('a package.json that is not valid JSON is reported, and nothing is written', async () => {
        const dir = folders.make('artemis-cli-');

        fs.writeFileSync(path.join(dir, 'package.json'), '{ nope');

        const result = await art(['init', '--json'], dir);

        expect(envelope(result.out)).toMatchObject({ ok: false, command: null });
        expect(fs.existsSync(path.join(dir, 'commands'))).toBe(false);
    });

    test('is reserved like help: a project command called init cannot be run through art', async () => {
        const dir = folders.make('artemis-cli-');

        makeProject(dir, { greeting: 'project' });

        fs.writeFileSync(
            path.join(dir, 'commands', 'init.js'),
            "import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'mine', run: () => ({ mine: true }) });\n"
        );

        const result = await art(['init', '--json'], dir);

        expect(envelope(result.out)).toMatchObject({
            command: 'init',
            result: { kept: expect.any(Array) }
        });
    });

    test('is not reserved for a published tool: its own commands are all its own', async () => {
        const tool = folders.make('artemis-tool-');

        makeProject(tool, {
            greeting: 'tool',
            manifest: { name: 'mytool', bin: { mytool: 'bin/mytool.js' } }
        });

        const stdout = createSink();

        const code = await cli({
            argv: ['init', '--json'],
            root: path.join(tool, 'bin', 'mytool.js'),
            stdout,
            stderr: createSink(),
            env: {},
            interactive: false
        });

        expect(code).toBe(EXIT_CODE.USAGE);

        expect(envelope(stdout.text)).toMatchObject({
            ok: false,
            error: 'Unknown command "init".'
        });
    });
});

describe('cli: the global flags on the built-in words', () => {
    test('init accepts --quiet', async () => {
        const root = folders.make('artemis-cli-');

        expect((await art(['init', '--quiet'], root)).code).toBe(EXIT_CODE.OK);
    });

    test('init refuses --dry-run with a usage error', async () => {
        const root = folders.make('artemis-cli-');

        expect((await art(['init', '--dry-run'], root)).code).toBe(EXIT_CODE.USAGE);
    });

    test('state refuses --log with a usage error', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project' });

        expect((await art(['state', '--log', 'x.log'], root)).code).toBe(EXIT_CODE.USAGE);
    });

    test('state accepts --quiet', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project' });

        expect((await art(['state', '--quiet'], root)).code).toBe(EXIT_CODE.OK);
    });

    test('state refuses --dry-run before the word', async () => {
        const root = folders.make('artemis-cli-');

        makeProject(root, { greeting: 'project' });

        expect((await art(['--dry-run', 'state'], root)).code).toBe(EXIT_CODE.USAGE);
    });
});
