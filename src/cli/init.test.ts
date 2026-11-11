import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { CommandError } from '../errors/errors.js';
import type { InitInput } from '../models.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { thrownBy } from '../test/thrown.js';
import { SAMPLE_COMMAND_FILE, SAMPLE_COMMAND_SOURCE, TYPE_WARNING } from './constants.js';
import { cli } from './index.js';
import { detectIndent, initProject, packageNameFor, planInit } from './init.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

/** A folder that has nothing yet: the starting point of most cases. */
const fresh = (overrides: Partial<InitInput> = {}): InitInput => ({
    dir: '/work/My App',
    manifestText: undefined,
    manifest: undefined,
    commandsDir: '/work/My App/commands',
    commandsDirExists: false,
    commandsDirIsEmpty: false,
    ...overrides
});

/** A folder that already has this package.json (and so its text). */
const withManifest = (text: string, overrides: Partial<InitInput> = {}): InitInput =>
    fresh({
        manifestText: text,
        manifest: JSON.parse(text) as Record<string, unknown>,
        ...overrides
    });

const fileStep = (plan: ReturnType<typeof planInit>, file: string) =>
    plan.steps.find((step) => step.kind === 'file' && step.path === file);

describe('packageNameFor', () => {
    test('is the folder name, lowercase', () => {
        expect(packageNameFor('/work/MyApp')).toBe('myapp');
    });

    test('replaces spaces and odd characters with dashes', () => {
        expect(packageNameFor('/work/My Cool App!')).toBe('my-cool-app');
    });

    test('drops dashes, dots and underscores at the edges', () => {
        expect(packageNameFor('/work/__app--')).toBe('app');
    });

    test('falls back to a plain name when nothing usable is left', () => {
        expect(packageNameFor('/work/***')).toBe('project');
    });
});

describe('detectIndent', () => {
    test('finds four spaces', () => {
        expect(detectIndent('{\n    "name": "a"\n}')).toBe('    ');
    });

    test('finds a tab', () => {
        expect(detectIndent('{\n\t"name": "a"\n}')).toBe('\t');
    });

    test('defaults to two spaces when nothing is indented', () => {
        expect(detectIndent('{ "name": "a" }')).toBe('  ');
    });
});

describe('planInit: a folder with nothing in it', () => {
    test('creates the package.json, the commands folder and a sample command', () => {
        const plan = planInit(fresh());

        expect(plan.steps.map((step) => [step.kind, path.basename(step.path)])).toEqual([
            ['file', 'package.json'],
            ['folder', 'commands'],
            ['file', SAMPLE_COMMAND_FILE]
        ]);
    });

    test('the new package.json is named after the folder, private, a module, and declares the project', () => {
        const step = fileStep(planInit(fresh()), '/work/My App/package.json');

        expect(JSON.parse(step?.kind === 'file' ? step.text : '{}')).toEqual({
            name: 'my-app',
            private: true,
            type: 'module',
            artemis: { commandsDir: 'commands' }
        });
    });

    test('the sample command is the one in the constants, so `hello` works at once', () => {
        const step = fileStep(planInit(fresh()), '/work/My App/commands/hello.js');

        expect(step?.kind === 'file' && step.text).toBe(SAMPLE_COMMAND_SOURCE);
    });

    test('has nothing to warn about, nothing was there to keep', () => {
        const plan = planInit(fresh());

        expect([plan.kept, plan.warnings]).toEqual([[], []]);
    });
});

describe('planInit: a package.json that already exists', () => {
    const text = '{\n    "name": "app",\n    "version": "1.0.0",\n    "type": "module"\n}\n';

    test('only gains the artemis key, at the end, and keeps every other key', () => {
        const step = fileStep(planInit(withManifest(text)), '/work/My App/package.json');

        expect(JSON.parse(step?.kind === 'file' ? step.text : '{}')).toEqual({
            name: 'app',
            version: '1.0.0',
            type: 'module',
            artemis: { commandsDir: 'commands' }
        });
    });

    test('keeps the indentation and the final newline it had', () => {
        const step = fileStep(planInit(withManifest(text)), '/work/My App/package.json');

        expect(step?.kind === 'file' && step.text).toBe(
            '{\n    "name": "app",\n    "version": "1.0.0",\n    "type": "module",\n    "artemis": {\n        "commandsDir": "commands"\n    }\n}\n'
        );
    });

    test('adds no final newline to a file that had none', () => {
        const step = fileStep(
            planInit(withManifest('{"name":"app","type":"module"}')),
            '/work/My App/package.json'
        );

        expect(step?.kind === 'file' && step.text.endsWith('\n')).toBe(false);
    });

    test('is left alone when it already declares the project', () => {
        const plan = planInit(withManifest('{ "name": "app", "type": "module", "artemis": {} }'));

        expect(fileStep(plan, '/work/My App/package.json')).toBeUndefined();
        expect(plan.kept).toContain('/work/My App/package.json');
    });

    test('warns, and does not change it, when it is not a module', () => {
        const plan = planInit(withManifest('{ "name": "app" }'));

        expect(plan.warnings).toEqual([TYPE_WARNING]);
    });

    test('does not warn when it is a module', () => {
        expect(planInit(withManifest(text)).warnings).toEqual([]);
    });
});

describe('planInit: the commands folder', () => {
    test('one that has files in it is kept, with no sample written over them', () => {
        const plan = planInit(fresh({ commandsDirExists: true, commandsDirIsEmpty: false }));

        expect(plan.steps.some((step) => step.path.endsWith('hello.js'))).toBe(false);
        expect(plan.kept).toContain('/work/My App/commands');
    });

    test('one that exists but is empty gets the sample, and is not created again', () => {
        const plan = planInit(fresh({ commandsDirExists: true, commandsDirIsEmpty: true }));

        expect(plan.steps.map((step) => [step.kind, path.basename(step.path)])).toEqual([
            ['file', 'package.json'],
            ['file', SAMPLE_COMMAND_FILE]
        ]);
    });

    test('is the configured folder, not always commands', () => {
        const plan = planInit(
            withManifest('{ "name": "app", "type": "module" }', {
                commandsDir: '/work/My App/tools'
            })
        );

        expect(
            plan.steps.filter((step) => step.kind === 'folder').map((step) => step.path)
        ).toEqual(['/work/My App/tools']);
    });
});

describe('initProject: on the disk', () => {
    test('makes a folder a project', () => {
        const dir = folders.make('artemis-init-');
        const result = initProject(dir);

        expect(result.created.map((file) => path.relative(dir, file)).sort()).toEqual([
            'commands',
            path.join('commands', 'hello.js'),
            'package.json'
        ]);
    });

    test('running it again creates nothing', () => {
        const dir = folders.make('artemis-init-');

        initProject(dir);

        expect(initProject(dir).created).toEqual([]);
    });

    test('never overwrites a command that is already there', () => {
        const dir = folders.make('artemis-init-');
        const hello = path.join(dir, 'commands', 'hello.js');

        fs.mkdirSync(path.dirname(hello));
        fs.writeFileSync(hello, 'export default "mine";\n');
        initProject(dir);

        expect(fs.readFileSync(hello, 'utf8')).toBe('export default "mine";\n');
    });

    test('adds the key to a package.json that exists and leaves its type alone', () => {
        const dir = folders.make('artemis-init-');
        const manifest = path.join(dir, 'package.json');

        fs.writeFileSync(manifest, '{ "name": "app", "type": "commonjs" }\n');

        const result = initProject(dir);

        expect(JSON.parse(fs.readFileSync(manifest, 'utf8'))).toMatchObject({
            type: 'commonjs',
            artemis: { commandsDir: 'commands' }
        });

        expect(result.warnings).toEqual([TYPE_WARNING]);
    });

    test('a package.json that is not valid JSON is an error and nothing is written', () => {
        const dir = folders.make('artemis-init-');

        fs.writeFileSync(path.join(dir, 'package.json'), '{ nope');

        expect(thrownBy(() => initProject(dir))).toBeInstanceOf(CommandError);
        expect(fs.existsSync(path.join(dir, 'commands'))).toBe(false);
    });

    test('after it, `hello` runs: the folder is a project and the sample works', async () => {
        const dir = folders.make('artemis-init-');
        const stdout = createSink();

        initProject(dir);

        const code = await cli({
            argv: ['hello', '--json'],
            cwd: dir,
            stdout,
            env: {},
            interactive: false
        });

        expect([code, JSON.parse(stdout.text)]).toEqual([
            0,
            { ok: true, command: 'hello', result: { greeting: 'hello world' } }
        ]);
    });
});
