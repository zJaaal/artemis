import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { STORE_INDENT_SPACES } from '../kits/store/constants.js';
import { defineStore } from '../kits/store/store.js';
import { LOCK_SUFFIX } from '../kits/store/constants.js';
import { createFakeLockOptions } from '../test/lock-edges.js';
import type { Envelope, PromptsFake } from '../test/models.js';
import { makeProject } from '../test/project.js';
import { makeStateProject } from '../test/state-project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { cli } from './index.js';
import { stateCommand } from './state-command.js';

// The fake stands in for `@topcli/prompts`, which needs a real terminal: it answers the confirm.
const fake = vi.hoisted<PromptsFake>(() => ({
    loads: 0,
    calls: [],
    answer: undefined,
    abort: false,
    waitForSignal: false,
    failure: undefined
}));

vi.mock('@topcli/prompts', () => {
    const abortError = () =>
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

    const unused = () => Promise.reject(new Error('state only asks yes or no'));

    return {
        multiselect: unused,
        question: unused,
        select: unused,
        confirm: (message: string, options: Record<string, unknown> = {}) => {
            fake.calls.push({ fn: 'confirm', message, options });

            return fake.abort ? Promise.reject(abortError()) : Promise.resolve(fake.answer);
        }
    };
});

const folders = createTempFolders();

beforeEach(() => {
    fake.calls = [];
    fake.answer = undefined;
    fake.abort = false;
});

afterEach(() => folders.cleanUp());

/** Runs the shipped command as if typed in `cwd`. */
const art = async (argv: string[], cwd: string, interactive = false) => {
    const stdout = createSink();
    const stderr = createSink();

    const code = await cli({ argv, cwd, stdout, stderr, env: {}, interactive, color: false });

    return { code, out: stdout.text, err: stderr.text };
};

const envelope = (out: string): Envelope => JSON.parse(out) as Envelope;

const resultOf = (out: string) => envelope(out).result as Record<string, unknown>;

const newProject = (options: Parameters<typeof makeStateProject>[1] = {}) => {
    const root = folders.make('artemis-state-');
    const dir = makeStateProject(root, options);

    return { root, dir };
};

const STEPS = { build: true, test: false };
const VERSIONED_STEPS = { $version: 2, data: STEPS };
const SERVE_ADVICE = 'Reset it with --reset to start again from the defaults.';

describe('art state: listing', () => {
    test('lists each document with its version and its path', async () => {
        const { root, dir } = newProject({
            documents: { instances: { a: 1 }, steps: VERSIONED_STEPS }
        });

        const result = await art(['state'], root);

        expect(result.out).toBe(
            [
                `instances  v0  ${path.relative(root, path.join(dir, 'instances.json'))}`,
                `steps  v2  ${path.relative(root, path.join(dir, 'steps.json'))}`,
                ''
            ].join('\n')
        );
    });

    test('exits 0', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        expect((await art(['state'], root)).code).toBe(EXIT_CODE.OK);
    });

    test('under --json prints one object with the absolute folder and the documents', async () => {
        const { root, dir } = newProject({
            documents: { instances: { a: 1 }, steps: VERSIONED_STEPS }
        });

        const result = await art(['state', '--json'], root);

        expect(envelope(result.out)).toEqual({
            ok: true,
            command: 'state',
            result: {
                dir,
                documents: [
                    { name: 'instances', version: 0, file: path.join(dir, 'instances.json') },
                    { name: 'steps', version: 2, file: path.join(dir, 'steps.json') }
                ]
            }
        });
    });

    test('never lists a lock, a temporary file or a file that is not json', async () => {
        const { root } = newProject({
            documents: { steps: STEPS },
            files: {
                'steps.json.lock': '123 token',
                'build.lock': '123 token',
                'steps.json.123.abc.tmp': '{}',
                'notes.txt': 'hi'
            }
        });

        const names = (
            resultOf((await art(['state', '--json'], root)).out).documents as { name: string }[]
        ).map((document) => document.name);

        expect(names).toEqual(['steps']);
    });

    test('a file whose name could not be a document is not listed', async () => {
        const { root } = newProject({ documents: { steps: STEPS, Odd: STEPS } });

        const names = (
            resultOf((await art(['state', '--json'], root)).out).documents as { name: string }[]
        ).map((document) => document.name);

        expect(names).toEqual(['steps']);
    });

    test('a document that cannot be read is listed with no version and its error, and the call still exits 0', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS, broken: '{ not json' } });
        const result = await art(['state', '--json'], root);

        expect([result.code, resultOf(result.out).documents]).toEqual([
            EXIT_CODE.OK,
            [
                {
                    name: 'broken',
                    version: null,
                    file: path.join(dir, 'broken.json'),
                    error: expect.stringContaining(
                        `${path.join(dir, 'broken.json')} is not valid JSON`
                    )
                },
                { name: 'steps', version: 0, file: path.join(dir, 'steps.json') }
            ]
        ]);
    });

    test('the text output shows the error after the name of a document that cannot be read', async () => {
        const { root } = newProject({ documents: { broken: '{ not json' } });
        const result = await art(['state'], root);

        expect(result.out).toContain('broken  cannot be read: ');
    });

    test('a state folder that does not exist says there is no state yet, and exits 0', async () => {
        const root = folders.make('artemis-state-');

        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ artemis: {} }));
        const result = await art(['state'], root);

        expect([result.code, result.out]).toEqual([
            EXIT_CODE.OK,
            `No state yet in ${path.relative(root, path.join(root, 'state'))}.\n`
        ]);
    });

    test('a state folder that does not exist has no documents under --json', async () => {
        const root = folders.make('artemis-state-');

        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ artemis: {} }));

        expect(resultOf((await art(['state', '--json'], root)).out)).toEqual({
            dir: path.join(root, 'state'),
            documents: []
        });
    });

    test('an empty state folder says the same', async () => {
        const { root } = newProject();

        expect((await art(['state'], root)).out).toContain('No state yet in');
    });

    test('the folder is "artemis".stateDir', async () => {
        const { root, dir } = newProject({ stateDir: 'data', documents: { steps: STEPS } });

        expect(resultOf((await art(['state', '--json'], root)).out).dir).toBe(dir);
    });

    test('from a folder deep inside the project it finds the same folder', async () => {
        const { root, dir } = newProject({ stateDir: 'data', documents: { steps: STEPS } });
        const deep = path.join(root, 'src', 'deep');

        fs.mkdirSync(deep, { recursive: true });

        expect(resultOf((await art(['state', '--json'], deep)).out).dir).toBe(dir);
    });

    test('defineStore({ project }) keeps its documents in the folder art state reads', async () => {
        const { root } = newProject({ stateDir: 'data' });
        const deep = path.join(root, 'src', 'deep');

        fs.mkdirSync(deep, { recursive: true });

        const doc = defineStore({ project: pathToFileURL(path.join(deep, 'x.js')).href }).doc(
            'mine',
            {
                fallback: {}
            }
        );

        doc.write({ saved: true });

        const { documents } = resultOf((await art(['state', '--json'], root)).out) as {
            documents: { file: string }[];
        };

        expect(documents.map((document) => document.file)).toEqual([doc.file]);
    });

    test('works in a project whose commands folder does not exist', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        expect((await art(['state'], root)).code).toBe(EXIT_CODE.OK);
    });

    test('with no project at all it fails and says what to create', async () => {
        const result = await art(['state', '--json'], folders.make('artemis-lonely-'));

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: 'state',
            error: expect.stringContaining('No project found')
        });
    });
});

describe('art state: a document that is a symbolic link', () => {
    /** A project whose `steps.json` is a link to a file kept elsewhere, as an app may arrange. */
    const linkedProject = () => {
        const { root, dir } = newProject();
        const target = path.join(folders.make('artemis-state-target-'), 'real-steps.json');

        fs.writeFileSync(target, JSON.stringify(STEPS));
        fs.symlinkSync(target, path.join(dir, 'steps.json'));

        return { root, dir, target };
    };

    test('is listed', async () => {
        const { root } = linkedProject();

        const names = (
            resultOf((await art(['state', '--json'], root)).out).documents as { name: string }[]
        ).map((document) => document.name);

        expect(names).toEqual(['steps']);
    });

    test('is shown, through the link', async () => {
        const { root } = linkedProject();

        expect(resultOf((await art(['state', 'steps', '--json'], root)).out).data).toEqual(STEPS);
    });

    test('is reset: the document goes away', async () => {
        const { root, dir } = linkedProject();

        await art(['state', 'steps', '--reset', '--yes', '--json'], root);

        expect(fs.existsSync(path.join(dir, 'steps.json'))).toBe(false);
    });

    test('is reset without touching the file the link pointed to', async () => {
        const { root, target } = linkedProject();

        await art(['state', 'steps', '--reset', '--yes', '--json'], root);

        expect(fs.readFileSync(target, 'utf8')).toBe(JSON.stringify(STEPS));
    });
});

describe('art state <doc>: showing', () => {
    test('prints the JSON of the document', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'steps'], root);

        expect(result.out).toBe(`${JSON.stringify(STEPS, null, STORE_INDENT_SPACES)}\n`);
    });

    test('a versioned document is printed with its $version wrapper', async () => {
        const { root } = newProject({ documents: { steps: VERSIONED_STEPS } });
        const result = await art(['state', 'steps'], root);

        expect(JSON.parse(result.out)).toEqual(VERSIONED_STEPS);
    });

    test('under --json it prints name, version, file and data', async () => {
        const { root, dir } = newProject({ documents: { steps: VERSIONED_STEPS } });
        const result = await art(['state', 'steps', '--json'], root);

        expect(envelope(result.out)).toEqual({
            ok: true,
            command: 'state',
            result: { name: 'steps', version: 2, file: path.join(dir, 'steps.json'), data: STEPS }
        });
    });

    test('an unknown document exits 1 and says where it looked', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'ghost', '--json'], root);

        expect([result.code, envelope(result.out)]).toEqual([
            EXIT_CODE.FAILED,
            {
                ok: false,
                command: 'state',
                error: `No document ghost in ${dir}`,
                hint: 'Documents there: steps.'
            }
        ]);
    });

    test('the hint lists every document that exists', async () => {
        const { root } = newProject({ documents: { instances: {}, steps: STEPS } });
        const result = await art(['state', 'ghost', '--json'], root);

        expect(envelope(result.out).hint).toBe('Documents there: instances, steps.');
    });

    test('with no documents at all the hint says so', async () => {
        const { root } = newProject();
        const result = await art(['state', 'ghost', '--json'], root);

        expect(envelope(result.out).hint).toBe('There are no documents yet.');
    });

    test.each([{ name: '..' }, { name: '../package' }, { name: 'a/b' }, { name: 'Steps' }])(
        'the name "$name" is reported as an unknown document, exit 1, never a stack trace',
        async ({ name }) => {
            const { root } = newProject({ documents: { steps: STEPS, Steps: STEPS } });
            const result = await art(['state', name, '--json'], root);

            expect([result.code, envelope(result.out).error]).toEqual([
                EXIT_CODE.FAILED,
                expect.stringContaining(`No document ${name} in `)
            ]);
        }
    );

    test('a corrupt document exits 1 with its error and says how to reset it', async () => {
        const { root, dir } = newProject({ documents: { steps: '{ not json' } });
        const result = await art(['state', 'steps', '--json'], root);

        expect([result.code, envelope(result.out)]).toEqual([
            EXIT_CODE.FAILED,
            {
                ok: false,
                command: 'state',
                error: expect.stringContaining(`${path.join(dir, 'steps.json')} is not valid JSON`),
                hint: SERVE_ADVICE
            }
        ]);
    });

    test('showing never changes the file', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });
        const before = fs.readFileSync(path.join(dir, 'steps.json'), 'utf8');

        await art(['state', 'steps'], root);

        expect(fs.readFileSync(path.join(dir, 'steps.json'), 'utf8')).toBe(before);
    });
});

describe('art state <doc> --reset', () => {
    test('with --yes deletes the file and says so, exit 0', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'steps', '--reset', '--yes'], root);

        expect([result.code, fs.existsSync(path.join(dir, 'steps.json'))]).toEqual([
            EXIT_CODE.OK,
            false
        ]);
    });

    test('under --json prints name, file and reset: true', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'steps', '--reset', '--yes', '--json'], root);

        expect(envelope(result.out)).toEqual({
            ok: true,
            command: 'state',
            result: { name: 'steps', file: path.join(dir, 'steps.json'), reset: true }
        });
    });

    test('leaves the other documents and no lock behind', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS, instances: { a: 1 } } });

        await art(['state', 'steps', '--reset', '--yes'], root);

        expect(fs.readdirSync(dir)).toEqual(['instances.json']);
    });

    test('without --yes and with nobody to answer fails with the hint and keeps the file', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'steps', '--reset', '--json'], root);

        expect([
            result.code,
            envelope(result.out).hint,
            fs.existsSync(path.join(dir, 'steps.json'))
        ]).toEqual([EXIT_CODE.FAILED, 'Pass --yes to reset without a question.', true]);
    });

    test('without --yes, as text, says the command needs input', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'steps', '--reset'], root);

        expect(result.err).toContain(
            'This command needs input, but it is not running interactively.'
        );
    });

    test('with a terminal it asks first, naming the document', async () => {
        fake.answer = true;

        const { root } = newProject({ documents: { steps: STEPS } });

        await art(['state', 'steps', '--reset'], root, true);

        expect(fake.calls[0]).toMatchObject({
            fn: 'confirm',
            message: 'Reset steps? The app starts again from its defaults.'
        });
    });

    test('the question defaults to no', async () => {
        fake.answer = true;

        const { root } = newProject({ documents: { steps: STEPS } });

        await art(['state', 'steps', '--reset'], root, true);

        expect(fake.calls[0]?.options).toMatchObject({ initial: false });
    });

    test('answering yes deletes the file', async () => {
        fake.answer = true;

        const { root, dir } = newProject({ documents: { steps: STEPS } });

        await art(['state', 'steps', '--reset'], root, true);

        expect(fs.existsSync(path.join(dir, 'steps.json'))).toBe(false);
    });

    test('answering no keeps the file and exits 0', async () => {
        fake.answer = false;

        const { root, dir } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'steps', '--reset'], root, true);

        expect([result.code, fs.existsSync(path.join(dir, 'steps.json'))]).toEqual([
            EXIT_CODE.OK,
            true
        ]);
    });

    test('answering no says the document is unchanged', async () => {
        fake.answer = false;

        const { root } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'steps', '--reset'], root, true);

        expect(result.out).toBe('Not reset: steps is unchanged.\n');
    });

    test('Ctrl+C at the question exits 1 with Cancelled. and keeps the file', async () => {
        fake.abort = true;

        const { root, dir } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'steps', '--reset'], root, true);

        expect([
            result.code,
            result.err.includes('Cancelled.'),
            fs.existsSync(path.join(dir, 'steps.json'))
        ]).toEqual([EXIT_CODE.FAILED, true, true]);
    });

    test('--yes never asks, even with a terminal', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        await art(['state', 'steps', '--reset', '--yes'], root, true);

        expect(fake.calls).toEqual([]);
    });

    test('resets a corrupt document', async () => {
        const { root, dir } = newProject({ documents: { steps: '{ not json' } });

        await art(['state', 'steps', '--reset', '--yes'], root);

        expect(fs.existsSync(path.join(dir, 'steps.json'))).toBe(false);
    });

    test('resets a document whose version is newer than any code knows', async () => {
        const { root, dir } = newProject({ documents: { steps: { $version: 99, data: STEPS } } });

        await art(['state', 'steps', '--reset', '--yes'], root);

        expect(fs.existsSync(path.join(dir, 'steps.json'))).toBe(false);
    });

    test('an unknown document is the same exit 1 as for show', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });
        const result = await art(['state', 'ghost', '--reset', '--yes', '--json'], root);

        expect([result.code, envelope(result.out).error]).toEqual([
            EXIT_CODE.FAILED,
            expect.stringContaining('No document ghost in ')
        ]);
    });

    test('a name that goes up a folder deletes nothing', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        fs.writeFileSync(path.join(root, 'outside.json'), '{}');
        await art(['state', '../outside', '--reset', '--yes'], root);

        expect(fs.existsSync(path.join(root, 'outside.json'))).toBe(true);
    });

    test('after a reset the app reads its defaults', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });

        await art(['state', 'steps', '--reset', '--yes'], root);

        expect(
            defineStore({ dir })
                .doc('steps', { fallback: { fresh: true } })
                .read()
        ).toEqual({
            fresh: true
        });
    });
});

describe('art state: a wrong command line exits 2', () => {
    test('a second argument', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        expect((await art(['state', 'steps', 'flags'], root)).code).toBe(EXIT_CODE.USAGE);
    });

    test('an unknown flag', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        expect((await art(['state', 'steps', '--set', '{}'], root)).code).toBe(EXIT_CODE.USAGE);
    });

    test('--reset without a document', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        expect((await art(['state', '--reset', '--yes'], root)).code).toBe(EXIT_CODE.USAGE);
    });

    test('and under --json it is the usual failure object, with the command', async () => {
        const { root } = newProject();
        const result = await art(['state', '--reset', '--json'], root);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: 'state',
            error: '--reset needs a document'
        });
    });

    test('a wrong command line deletes nothing', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });

        await art(['state', 'steps', 'flags', '--reset', '--yes'], root);

        expect(fs.existsSync(path.join(dir, 'steps.json'))).toBe(true);
    });
});

describe('art state --help', () => {
    test('prints its usage and exits 0', async () => {
        const { root } = newProject();
        const result = await art(['state', '--help'], root);

        expect([result.code, result.out]).toEqual([
            EXIT_CODE.OK,
            expect.stringContaining('Usage: state [<doc>] [--reset] [--yes] [--quiet] [--json]')
        ]);
    });

    test('works where there is no project', async () => {
        const result = await art(['state', '-h'], folders.make('artemis-lonely-'));

        expect(result.code).toBe(EXIT_CODE.OK);
    });
});

describe('art state: the word is the binary’s own', () => {
    test('a project command called state is hidden, with a warning on stderr', async () => {
        const root = folders.make('artemis-state-');

        makeProject(root, { greeting: 'project', manifest: { artemis: {} } });

        fs.writeFileSync(
            path.join(root, 'commands', 'state.js'),
            "import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'mine', run: () => ({ mine: true }) });\n"
        );

        const result = await art(['state', '--json'], root);

        expect([resultOf(result.out).documents, result.err]).toEqual([
            [],
            expect.stringContaining('has a command or topic called "state"')
        ]);
    });

    test('the warning never reaches stdout, so --json stays one object', async () => {
        const root = folders.make('artemis-state-');

        makeProject(root, { greeting: 'project', manifest: { artemis: {} } });
        fs.mkdirSync(path.join(root, 'commands', 'state'));

        const result = await art(['state', '--json'], root);

        expect(envelope(result.out).ok).toBe(true);
    });

    test('a project with no such command prints no warning', async () => {
        const { root } = newProject();

        expect((await art(['state'], root)).err).toBe('');
    });

    test('a published tool has no state word: its own state command runs', async () => {
        const tool = folders.make('artemis-tool-');

        makeProject(tool, {
            greeting: 'tool',
            manifest: { name: 'mytool', bin: { mytool: 'bin/mytool.js' } }
        });

        fs.writeFileSync(
            path.join(tool, 'commands', 'state.js'),
            "import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'mine', run: () => ({ mine: true }) });\n"
        );

        const stdout = createSink();

        await cli({
            argv: ['state', '--json'],
            root: path.join(tool, 'bin', 'mytool.js'),
            stdout,
            stderr: createSink(),
            env: {},
            interactive: false
        });

        expect(envelope(stdout.text)).toMatchObject({
            ok: true,
            command: 'state',
            result: { mine: true }
        });
    });
});

describe('art state --reset waits for the document lock', () => {
    const HOLDER_PID = 4242;
    const DEAD_PID = 999_999;
    const TIMEOUT_MS = 100;

    /** Runs the state command itself, with a fake clock and liveness, so no test sleeps. */
    const reset = (root: string, lock: ReturnType<typeof createFakeLockOptions>['options']) => {
        const stdout = createSink();
        const stderr = createSink();

        return stateCommand(
            ['steps', '--reset', '--yes'],
            { stdout, stderr, env: {}, interactive: false, color: false },
            root,
            { lock }
        );
    };

    const heldBy = (pid: number) => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });
        const lock = path.join(dir, `steps.json${LOCK_SUFFIX}`);

        fs.writeFileSync(lock, `${pid} theirs`);

        return { root, dir, lock };
    };

    test('a reset waits while another process holds the lock, then deletes the file', async () => {
        const { root, dir, lock } = heldBy(HOLDER_PID);

        const { options, pauses } = createFakeLockOptions({
            isProcessAlive: (pid) => pid === HOLDER_PID,
            timeoutMs: TIMEOUT_MS,
            onPause: () => fs.rmSync(lock, { force: true })
        });

        await reset(root, options);

        expect([pauses.length > 0, fs.existsSync(path.join(dir, 'steps.json'))]).toEqual([
            true,
            false
        ]);
    });

    test('a reset gives up after the lock timeout, and the file is still there', async () => {
        const { root, dir } = heldBy(HOLDER_PID);

        const { options } = createFakeLockOptions({
            isProcessAlive: (pid) => pid === HOLDER_PID,
            timeoutMs: TIMEOUT_MS
        });

        await expect(reset(root, options)).rejects.toMatchObject({
            message: `${path.join(dir, 'steps.json')} is locked by process ${HOLDER_PID}.`
        });

        expect(fs.existsSync(path.join(dir, 'steps.json'))).toBe(true);
    });

    test('a lock left by a dead process is taken over without waiting', async () => {
        const { root, dir } = heldBy(DEAD_PID);

        const { options, pauses } = createFakeLockOptions({
            isProcessAlive: (pid) => pid === HOLDER_PID,
            timeoutMs: TIMEOUT_MS
        });

        await reset(root, options);

        expect([pauses, fs.existsSync(path.join(dir, 'steps.json'))]).toEqual([[], false]);
    });
});

describe('art state: a link that cannot be followed', () => {
    /** A state folder with one good document and one link that points at itself. */
    const projectWithLoop = () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });

        fs.symlinkSync('loop.json', path.join(dir, 'loop.json'));

        return { root };
    };

    test('does not fail the listing', async () => {
        const { root } = projectWithLoop();

        expect((await art(['state', '--json'], root)).code).toBe(EXIT_CODE.OK);
    });

    test('is listed with no version and the reason it cannot be read', async () => {
        const { root } = projectWithLoop();
        const documents = resultOf((await art(['state', '--json'], root)).out).documents;

        expect(documents).toContainEqual({
            name: 'loop',
            version: null,
            file: expect.stringContaining('loop.json'),
            error: expect.stringContaining('cannot be read')
        });
    });

    test('leaves the other documents listed with their versions', async () => {
        const { root } = projectWithLoop();
        const documents = resultOf((await art(['state', '--json'], root)).out).documents;

        expect(documents).toContainEqual({
            name: 'steps',
            version: 0,
            file: expect.stringContaining('steps.json')
        });
    });

    test('shows the reason in the text listing, without a stack', async () => {
        const { root } = projectWithLoop();
        const result = await art(['state'], root);

        expect([result.out.includes('loop  cannot be read'), result.err]).toEqual([true, '']);
    });
});

describe('art state: a state folder that is a file', () => {
    const projectWithFileAsFolder = () => {
        const { root, dir } = newProject();

        fs.rmSync(dir, { recursive: true });
        fs.writeFileSync(dir, 'not a folder');

        return { root, dir };
    };

    test('is a failure (exit 1)', async () => {
        const { root } = projectWithFileAsFolder();

        expect((await art(['state', '--json'], root)).code).toBe(EXIT_CODE.FAILED);
    });

    test('names the folder and says where to fix it', async () => {
        const { root, dir } = projectWithFileAsFolder();

        expect(envelope((await art(['state', '--json'], root)).out)).toMatchObject({
            ok: false,
            command: 'state',
            error: `The state folder ${dir} is not a folder.`,
            hint: 'Fix "artemis".stateDir in package.json, or remove that file.'
        });
    });

    test('prints no stack in text mode', async () => {
        const { root } = projectWithFileAsFolder();

        expect((await art(['state'], root)).err).not.toContain('ENOTDIR');
    });
});

describe('art state: a state folder that cannot be read', () => {
    /** The state folder sits below a file, so listing it fails with ENOTDIR: the same path as EACCES. */
    const projectBelowAFile = () => {
        const { root } = newProject();
        const blocker = path.join(root, 'blocker');

        fs.writeFileSync(blocker, 'a file');

        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ name: 'project', artemis: { stateDir: 'blocker/state' } })
        );

        return { root, dir: path.join(blocker, 'state') };
    };

    test('is a failure (exit 1)', async () => {
        const { root } = projectBelowAFile();

        expect((await art(['state', '--json'], root)).code).toBe(EXIT_CODE.FAILED);
    });

    test('names the folder, and says where to look', async () => {
        const { root, dir } = projectBelowAFile();
        const result = envelope((await art(['state', '--json'], root)).out);

        expect(result).toMatchObject({
            ok: false,
            command: 'state',
            error: expect.stringContaining(`Cannot read the state folder ${dir}`),
            hint: `Check the permissions of ${dir}, or fix "artemis".stateDir in package.json.`
        });
    });

    test('prints no stack in text mode', async () => {
        const { root } = projectBelowAFile();

        expect((await art(['state'], root)).err).not.toContain('    at ');
    });
});

describe('art state: flags before the word', () => {
    test('a flag that is not global is a usage error (exit 2)', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        expect((await art(['--reset', '--yes', 'state', 'steps', '--json'], root)).code).toBe(
            EXIT_CODE.USAGE
        );
    });

    test('it never resets what the misplaced flag was meant for', async () => {
        const { root, dir } = newProject({ documents: { steps: STEPS } });

        await art(['--reset', '--yes', 'state', 'steps'], root);

        expect(fs.existsSync(path.join(dir, 'steps.json'))).toBe(true);
    });

    test('the error says which flag and where it goes', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });
        const result = await art(['--reset', 'state', 'steps', '--json'], root);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            error: '"--reset" cannot come before state'
        });
    });

    test('a global flag before the word still works', async () => {
        const { root } = newProject({ documents: { steps: STEPS } });

        expect(envelope((await art(['--json', 'state'], root)).out)).toMatchObject({
            ok: true,
            command: 'state'
        });
    });
});

describe('art state --help --json', () => {
    test('is one object holding the manifest entry of state', async () => {
        const { root } = newProject();

        expect(envelope((await art(['state', '--help', '--json'], root)).out)).toMatchObject({
            ok: true,
            command: 'state',
            result: { id: 'state', usage: expect.stringContaining('state'), aliases: [] }
        });
    });

    test('lists --reset among its flags', async () => {
        const { root } = newProject();
        const flags = resultOf((await art(['state', '--help', '--json'], root)).out).flags;

        expect(flags).toContainEqual(expect.objectContaining({ name: 'reset' }));
    });

    test('works where there is no project', async () => {
        const result = await art(['state', '--help', '--json'], folders.make('artemis-state-'));

        expect(envelope(result.out)).toMatchObject({ ok: true, command: 'state' });
    });
});
