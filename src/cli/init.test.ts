import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { CommandError } from '../errors/errors.js';
import type { InitInput } from '../models.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { thrownBy } from '../test/thrown.js';
import {
    SAMPLE_COMMAND_FILE,
    SAMPLE_COMMAND_SOURCE,
    SHADOW_WARNING,
    TYPE_WARNING
} from './constants.js';
import { cli } from './index.js';
import { addKey, detectIndent, initProject, packageNameFor, planInit } from './init.js';

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
    shadowsCommand: false,
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

    test('changes nothing but the one added line: indentation and final newline are kept', () => {
        const step = fileStep(planInit(withManifest(text)), '/work/My App/package.json');

        expect(step?.kind === 'file' && step.text).toBe(
            '{\n    "name": "app",\n    "version": "1.0.0",\n    "type": "module",\n    "artemis": { "commandsDir": "commands" }\n}\n'
        );
    });

    test('the edit of an existing package.json is the one deliberate rewrite; new files are created', () => {
        const plan = planInit(withManifest(text));

        expect(plan.steps.map((step) => step.kind === 'file' && step.mode)).toEqual([
            'update',
            false,
            'create'
        ]);
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
            '.gitignore',
            'AGENTS.md',
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

describe('addKey: the text of a package.json, edited and not rewritten', () => {
    const value = '{ "commandsDir": "commands" }';

    test('adds the property after the last one, with the comma', () => {
        expect(addKey('{\n  "name": "app"\n}\n', 'artemis', value)).toBe(
            '{\n  "name": "app",\n  "artemis": { "commandsDir": "commands" }\n}\n'
        );
    });

    test('leaves an inline array exactly as it was written', () => {
        const text = '{\n  "name": "app",\n  "files": ["dist", "docs"]\n}\n';

        expect(addKey(text, 'artemis', value)).toContain('"files": ["dist", "docs"],\n');
    });

    test('keeps CRLF line endings, including in the line it adds', () => {
        const result = addKey('{\r\n  "name": "app"\r\n}\r\n', 'artemis', value);

        expect(result).toBe(
            '{\r\n  "name": "app",\r\n  "artemis": { "commandsDir": "commands" }\r\n}\r\n'
        );
    });

    test('keeps tab indentation', () => {
        expect(addKey('{\n\t"name": "app"\n}\n', 'artemis', value)).toContain('\t"artemis":');
    });

    test('keeps the key order, with the new key last', () => {
        const result = addKey('{\n  "b": 1,\n  "a": 2\n}', 'artemis', value);

        expect(Object.keys(JSON.parse(result) as object)).toEqual(['b', 'a', 'artemis']);
    });

    test('works on an empty object, with no comma', () => {
        expect(JSON.parse(addKey('{}', 'artemis', value))).toEqual({
            artemis: { commandsDir: 'commands' }
        });
    });

    test('works when the last property is itself an object', () => {
        const result = addKey('{\n  "scripts": {\n    "a": "b"\n  }\n}\n', 'artemis', value);

        expect(JSON.parse(result)).toEqual({
            scripts: { a: 'b' },
            artemis: { commandsDir: 'commands' }
        });
    });

    test('a file written on one line stays on one line', () => {
        expect(addKey('{"name":"app"}', 'artemis', value)).toBe(
            '{"name":"app", "artemis": { "commandsDir": "commands" } }'
        );
    });

    test('adds no final newline to a file that had none, and keeps one that it had', () => {
        const none = addKey('{\n  "a": 1\n}', 'artemis', value);
        const one = addKey('{\n  "a": 1\n}\n', 'artemis', value);

        expect([none.endsWith('\n'), one.endsWith('\n')]).toEqual([false, true]);
    });
});

describe('planInit: the init word hiding a command', () => {
    test('warns when a command or topic called init is already there', () => {
        expect(planInit(fresh({ shadowsCommand: true })).warnings).toContain(SHADOW_WARNING);
    });

    test('says nothing otherwise', () => {
        expect(planInit(fresh()).warnings).not.toContain(SHADOW_WARNING);
    });
});

describe('initProject: what gets in the way', () => {
    test('a commands path that is a file is an error with a hint, and nothing is written', () => {
        const dir = folders.make('artemis-init-');

        fs.writeFileSync(path.join(dir, 'commands'), 'not a folder');

        expect(thrownBy(() => initProject(dir))).toMatchObject({
            message: `${path.join(dir, 'commands')} exists but is not a folder`,
            hint: expect.stringContaining('commandsDir')
        });

        expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(false);
    });

    test('warns about a command called init in the project it initialises', () => {
        const dir = folders.make('artemis-init-');

        fs.mkdirSync(path.join(dir, 'commands'));
        fs.writeFileSync(path.join(dir, 'commands', 'init.js'), 'export default {};\n');

        expect(initProject(dir).warnings).toContain(SHADOW_WARNING);
    });

    test('a topic folder called init is hidden too, and warned about', () => {
        const dir = folders.make('artemis-init-');

        fs.mkdirSync(path.join(dir, 'commands', 'init'), { recursive: true });

        expect(initProject(dir).warnings).toContain(SHADOW_WARNING);
    });

    test('edits an existing package.json byte for byte except for the added line', () => {
        const dir = folders.make('artemis-init-');
        const manifest = path.join(dir, 'package.json');

        const original =
            '{\r\n    "name": "app",\r\n    "type": "module",\r\n    "files": ["dist"]\r\n}\r\n';

        fs.writeFileSync(manifest, original);
        initProject(dir);

        expect(fs.readFileSync(manifest, 'utf8')).toBe(
            original.replace(
                '["dist"]\r\n}',
                '["dist"],\r\n    "artemis": { "commandsDir": "commands" }\r\n}'
            )
        );
    });

    test('a commands folder that already has files is left as it is', () => {
        const dir = folders.make('artemis-init-');
        const other = path.join(dir, 'commands', 'other.js');

        fs.mkdirSync(path.dirname(other));
        fs.writeFileSync(other, 'export default {};\n');
        initProject(dir);

        expect(fs.readdirSync(path.join(dir, 'commands'))).toEqual(['other.js']);
    });
});
