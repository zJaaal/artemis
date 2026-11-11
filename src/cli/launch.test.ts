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

    test('a named package without commands, in a monorepo, fails about its own commands instead of running the root’s', async () => {
        const root = folders.make('artemis-cli-');
        const inner = path.join(root, 'packages', 'inner');

        makeProject(root, { greeting: 'outer' });
        fs.mkdirSync(inner, { recursive: true });
        fs.writeFileSync(path.join(inner, 'package.json'), '{ "name": "inner" }');

        const result = await art(['hello', '--json'], inner);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            error: `Commands folder not found: ${path.join(inner, 'commands')}`
        });
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

describe('cli: when it cannot find what to run', () => {
    test('with no project up the tree it fails and says what to create', async () => {
        const nowhere = folders.make('artemis-cli-');
        const result = await art(['hello'], nowhere);

        expect(result.code).toBe(EXIT_CODE.FAILED);
        expect(result.err).toContain(`No project found from ${nowhere} upwards`);
        expect(result.err).toContain('a folder with a package.json that has a "name"');
    });

    test('a package.json that is only a marker is not a project', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }');

        expect((await art(['hello'], root)).err).toContain(`No project found from ${root} upwards`);
    });

    test('a named package.json with no commands folder is the project, and says so', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "empty" }');

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
            hint: expect.stringContaining('a folder with a package.json that has a "name"')
        });

        expect(result.err).toBe('');
    });

    test('a project with no commands folder says which folder to create', async () => {
        const root = folders.make('artemis-cli-');

        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ name: 'empty', artemis: {} })
        );

        const result = await art(['hello', '--json'], root);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: `Commands folder not found: ${path.join(root, 'commands')}`,
            hint: `Create ${path.join(root, 'commands')}, or set "artemis": { "commandsDir" } in ${path.join(root, 'package.json')}.`
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

        expect(envelope(result.out)).toMatchObject({ ok: false, command: null });
    });

    test('a package.json that cannot be read fails and names the file, with no stack trace', async () => {
        const root = folders.make('artemis-cli-');

        fs.mkdirSync(path.join(root, 'package.json'));

        const result = await art(['hello'], root);

        expect(result.err).toContain(`Cannot read ${path.join(root, 'package.json')}`);
        expect(result.err).not.toMatch(/\s+at /);
    });
});

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
            error: expect.stringContaining('No project found from'),
            hint: expect.stringContaining('If you maintain it')
        });
    });

    test('a tool whose bin file is in dist, next to a type marker package.json, still finds its own package', async () => {
        const toolRoot = folders.make('artemis-tool-');
        const dist = path.join(toolRoot, 'dist');

        makeProject(toolRoot, { greeting: 'tool', manifest: { name: 'mytool' } });
        fs.mkdirSync(dist);
        fs.writeFileSync(path.join(dist, 'package.json'), '{ "type": "module" }');

        const result = await ownArt(['hello', '--json'], path.join(dist, 'bin.js'));

        expect(envelope(result.out).result).toEqual({ greeting: 'tool' });
    });

    test('a tool that does not ship its commands never runs the commands of the project that installed it', async () => {
        const user = folders.make('artemis-cli-');
        const tool = path.join(user, 'node_modules', 'mytool');

        makeProject(user, { greeting: 'the user' });
        fs.mkdirSync(path.join(tool, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(tool, 'package.json'), '{ "name": "mytool" }');

        const result = await ownArt(['hello', '--json'], path.join(tool, 'bin', 'mytool.js'));

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: null,
            error: `Commands folder not found: ${path.join(tool, 'commands')}`
        });
    });

    test('the failure of a tool without commands tells its author what to ship', async () => {
        const tool = folders.make('artemis-tool-');

        fs.writeFileSync(path.join(tool, 'package.json'), '{ "name": "mytool" }');

        const result = await ownArt(['hello', '--json'], path.join(tool, 'bin', 'mytool.js'));

        expect(envelope(result.out).hint).toContain('its author has to ship the commands folder');
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
