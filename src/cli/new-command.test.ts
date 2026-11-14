import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import type { Envelope } from '../test/models.js';
import { commandSource, makeProject, writeCommand } from '../test/project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { NEW_USAGE_LINE, TYPE_WARNING } from './constants.js';
import { cli } from './index.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

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

const newProject = (
    manifest: Record<string, unknown> = { type: 'module', artemis: {} }
): string => {
    const root = folders.make('artemis-new-');

    makeProject(root, { greeting: 'project', manifest });

    return root;
};

const DB_RESET = [
    'new',
    'db',
    'reset',
    '--description',
    'Delete the local database and rebuild it',
    '--destructive',
    '--supports-dry-run'
];

describe('art new: what it writes and says', () => {
    test('writes commands/<topic>/<name>.js', async () => {
        const root = newProject();

        await art(DB_RESET, root);

        expect(fs.existsSync(path.join(root, 'commands', 'db', 'reset.js'))).toBe(true);
    });

    test('says Created with the absolute path', async () => {
        const root = newProject();
        const { out } = await art(DB_RESET, root);

        expect(out).toBe(`Created ${path.join(root, 'commands', 'db', 'reset.js')}\n`);
    });

    test('and, on stderr, what to run next', async () => {
        expect((await art(DB_RESET, newProject())).err).toBe('Next: art db reset --help\n');
    });

    test('--quiet hides the Next line and still says Created', async () => {
        const result = await art([...DB_RESET, '--quiet'], newProject());

        expect([result.err, result.out.startsWith('Created ')]).toEqual(['', true]);
    });

    test('the Next line uses the bin the project configured', async () => {
        const root = newProject({ type: 'module', artemis: { bin: 'mytool' } });

        expect((await art(DB_RESET, root)).err).toBe('Next: mytool db reset --help\n');
    });

    test('--json is the envelope with the id, the file and next', async () => {
        const root = newProject();
        const result = await art([...DB_RESET, '--json'], root);

        expect(JSON.parse(result.out)).toEqual({
            ok: true,
            command: 'new',
            result: { id: 'db reset', file: path.join(root, 'commands', 'db', 'reset.js') },
            next: ['art db reset --help']
        });
    });

    test('--json prints no Next line on stderr', async () => {
        expect((await art([...DB_RESET, '--json'], newProject())).err).toBe('');
    });

    test('creates the commands folder when there is none', async () => {
        const root = newProject();

        fs.rmSync(path.join(root, 'commands'), { recursive: true });

        await art(['new', 'hello', '--description', 'Say hello'], root);

        expect(fs.existsSync(path.join(root, 'commands', 'hello.js'))).toBe(true);
    });

    test('follows "artemis".commandsDir', async () => {
        const root = newProject({ type: 'module', artemis: { commandsDir: 'tools/cmds' } });

        await art(['new', 'hello', '--description', 'Say hello'], root);

        expect(fs.existsSync(path.join(root, 'tools', 'cmds', 'hello.js'))).toBe(true);
    });

    test('works from a folder inside the project', async () => {
        const root = newProject();

        fs.mkdirSync(path.join(root, 'src'));

        expect((await art(DB_RESET, path.join(root, 'src'))).code).toBe(EXIT_CODE.OK);
    });

    test('words in a different order around the flags are the same command', async () => {
        const root = newProject();

        await art(['new', 'db', '--description', 'x', 'reset'], root);

        expect(fs.existsSync(path.join(root, 'commands', 'db', 'reset.js'))).toBe(true);
    });
});

describe('art new: the type warning', () => {
    test('a package.json that does not say "type": "module" gets the init warning on stderr', async () => {
        const root = newProject({ artemis: {} });

        expect((await art(DB_RESET, root)).err).toContain(`Warning: ${TYPE_WARNING}`);
    });

    test('--quiet hides it', async () => {
        const root = newProject({ artemis: {} });

        expect((await art([...DB_RESET, '--quiet'], root)).err).toBe('');
    });

    test('a module project gets none', async () => {
        expect((await art(DB_RESET, newProject())).err).not.toContain('Warning');
    });
});

describe('art new: a command line that is wrong is a usage error (exit 2)', () => {
    const usageErrors: { name: string; argv: string[] }[] = [
        { name: 'no words', argv: ['new', '--description', 'x'] },
        { name: 'a word with a capital', argv: ['new', 'Db', '--description', 'x'] },
        { name: 'no description', argv: ['new', 'db'] },
        { name: 'an empty description', argv: ['new', 'db', '--description='] },
        { name: 'a description with a line break', argv: ['new', 'db', '--description', 'a\nb'] },
        { name: 'a first word of the binary', argv: ['new', 'history', '--description', 'x'] },
        { name: 'the word new itself', argv: ['new', 'new', '--description', 'x'] },
        { name: 'help as the first word', argv: ['new', 'help', '--description', 'x'] },
        { name: 'a reserved flag', argv: ['new', 'db', '--description', 'x', '--flag', 'json'] },
        {
            name: 'a flag named twice',
            argv: ['new', 'db', '--description', 'x', '--flag', 'a', '--flag', 'a']
        },
        {
            name: 'an arg and a flag with one name',
            argv: ['new', 'db', '--description', 'x', '--arg', 'a', '--flag', 'a']
        },
        { name: '--yes', argv: [...DB_RESET, '--yes'] },
        { name: '--dry-run', argv: [...DB_RESET, '--dry-run'] },
        { name: '--log', argv: [...DB_RESET, '--log', 'x.log'] },
        { name: 'an unknown option', argv: [...DB_RESET, '--bogus'] }
    ];

    test.each(usageErrors)('$name', async ({ argv }) => {
        const root = newProject();

        expect((await art(argv, root)).code).toBe(EXIT_CODE.USAGE);
    });

    test.each(usageErrors)('$name writes nothing', async ({ argv }) => {
        const root = newProject();

        await art(argv, root);

        expect(fs.readdirSync(path.join(root, 'commands'))).toEqual(['hello.js']);
    });

    test('the hint for a first word of the binary says the command would be hidden', async () => {
        const result = await art(['new', 'state', '--description', 'x', '--json'], newProject());

        expect(envelope(result.out).hint).toContain('hidden');
    });

    test('the error names the usage of the word in text mode', async () => {
        expect((await art(['new', '--description', 'x'], newProject())).err).toContain(
            NEW_USAGE_LINE
        );
    });
});

describe('art new: what it refuses (exit 1, nothing written)', () => {
    test('a file that exists is left untouched', async () => {
        const root = newProject();
        const file = path.join(root, 'commands', 'hello.js');
        const before = fs.readFileSync(file, 'utf8');
        const result = await art(['new', 'hello', '--description', 'x'], root);

        expect([result.code, fs.readFileSync(file, 'utf8')]).toEqual([EXIT_CODE.FAILED, before]);
    });

    test('and the message names the file', async () => {
        const root = newProject();
        const result = await art(['new', 'hello', '--description', 'x', '--json'], root);

        expect(envelope(result.out).error).toContain(path.join(root, 'commands', 'hello.js'));
    });

    test('a second identical call exits 1 with the first file untouched', async () => {
        const root = newProject();

        await art(DB_RESET, root);

        const file = path.join(root, 'commands', 'db', 'reset.js');
        const first = fs.readFileSync(file, 'utf8');
        const second = await art(DB_RESET, root);

        expect([second.code, fs.readFileSync(file, 'utf8')]).toEqual([EXIT_CODE.FAILED, first]);
    });

    test('a name that is a topic (a folder of that name)', async () => {
        const root = newProject();

        writeCommand(path.join(root, 'commands'), 'db/seed', 'export default 1;\n');

        const result = await art(['new', 'db', '--description', 'x', '--json'], root);

        expect(envelope(result.out).error).toContain(path.join(root, 'commands', 'db'));
    });

    test('a topic folder is not turned into a command: nothing is written', async () => {
        const root = newProject();

        writeCommand(path.join(root, 'commands'), 'db/seed', 'export default 1;\n');
        await art(['new', 'db', '--description', 'x'], root);

        expect(fs.existsSync(path.join(root, 'commands', 'db.js'))).toBe(false);
    });

    test('an earlier word that is already a command file', async () => {
        const root = newProject();
        const result = await art(['new', 'hello', 'world', '--description', 'x', '--json'], root);

        expect([result.code, envelope(result.out).error]).toEqual([
            EXIT_CODE.FAILED,
            expect.stringContaining(path.join(root, 'commands', 'hello.js'))
        ]);
    });

    test('and no folder is made for it', async () => {
        const root = newProject();

        await art(['new', 'hello', 'world', '--description', 'x'], root);

        expect(fs.existsSync(path.join(root, 'commands', 'hello'))).toBe(false);
    });

    test('a part of the path that is a file is a failure that says so, not a stack', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'commands', 'blocker'), 'a file');

        const result = await art(['new', 'blocker', 'x', '--description', 'x'], root);

        expect([result.code, result.err.includes('    at ')]).toEqual([EXIT_CODE.FAILED, false]);
    });

    test('outside a project it is the no-project error, whose hint mentions init', async () => {
        const result = await art(
            ['new', 'x', '--description', 'x', '--json'],
            folders.make('artemis-nowhere-')
        );

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            command: 'new',
            hint: expect.stringContaining('init')
        });
    });
});

describe('art new: the word itself', () => {
    test('--help prints its usage, in a project or not', async () => {
        const result = await art(['new', '--help'], folders.make('artemis-nowhere-'));

        expect([result.code, result.out]).toEqual([
            EXIT_CODE.OK,
            expect.stringContaining(`Usage: ${NEW_USAGE_LINE}`)
        ]);
    });

    test('--help --json prints its manifest entry', async () => {
        const result = await art(['new', '--help', '--json'], newProject());

        expect(envelope(result.out)).toMatchObject({
            ok: true,
            command: 'new',
            result: { id: 'new', usage: NEW_USAGE_LINE }
        });
    });

    test('is listed under builtins', async () => {
        const result = envelope((await art(['help', '--json'], newProject())).out).result as {
            builtins: { id: string }[];
        };

        expect(result.builtins.map((builtin) => builtin.id)).toContain('new');
    });

    test('a command called new is hidden, and doctor reports it', async () => {
        const root = newProject();

        writeCommand(path.join(root, 'commands'), 'new', commandSource('flags: {}'));

        const { checks } = (envelope((await art(['doctor', '--json'], root)).out).result ?? {}) as {
            checks: { id: string; status: string }[];
        };

        expect(checks.find((check) => check.id === 'words')?.status).toBe('warn');
    });

    test('is not recorded in the audit trail', async () => {
        const root = newProject();

        await art(DB_RESET, root);

        expect(fs.existsSync(path.join(root, 'state', 'audit.jsonl'))).toBe(false);
    });
});

describe('art new: every variant of the stub is a command that loads and runs', () => {
    const variants: { name: string; extra: string[]; runs: string[]; result: unknown }[] = [
        { name: 'with nothing', extra: [], runs: ['--json'], result: null },
        { name: 'destructive', extra: ['--destructive'], runs: ['--json', '--yes'], result: null },
        {
            name: 'with a dry run',
            extra: ['--supports-dry-run'],
            runs: ['--json', '--dry-run'],
            result: null
        },
        {
            name: 'with flags',
            extra: ['--flag', 'keep', '--flag', 'no-prune'],
            runs: ['--json', '--keep', '--no-prune'],
            result: { flags: { keep: true, 'no-prune': true } }
        },
        {
            name: 'with everything but an arg',
            extra: ['--destructive', '--supports-dry-run', '--flag', 'keep'],
            runs: ['--json', '--yes', '--keep'],
            result: { flags: { keep: true } }
        }
    ];

    test.each(variants)('$name: --help exits 0', async ({ extra }) => {
        const root = newProject();

        await art(['new', 'x', 'y', '--description', 'A new one', ...extra], root);

        expect((await art(['x', 'y', '--help'], root)).code).toBe(EXIT_CODE.OK);
    });

    test.each(variants)(
        '$name: it runs and returns what it should',
        async ({ extra, runs, result }) => {
            const root = newProject();

            await art(['new', 'x', 'y', '--description', 'A new one', ...extra], root);

            expect(envelope((await art(['x', 'y', ...runs], root)).out)).toMatchObject({
                ok: true,
                command: 'x y',
                result
            });
        }
    );

    test('with args: --help exits 0 and the args are required', async () => {
        const root = newProject();

        await art(['new', 'x', '--description', 'd', '--arg', 'source', '--arg', 'target'], root);

        expect([
            (await art(['x', '--help'], root)).code,
            (await art(['x', 'one', '--json'], root)).code,
            envelope((await art(['x', 'one', 'two', '--json'], root)).out).result
        ]).toEqual([EXIT_CODE.OK, EXIT_CODE.USAGE, { args: { source: 'one', target: 'two' } }]);
    });

    test('the description, with its quotes, is what help shows', async () => {
        const root = newProject();

        await art(['new', 'x', '--description', `Delete today's "old" data`], root);

        expect((await art(['x', '--help'], root)).out).toContain(`Delete today's "old" data`);
    });

    test('a destructive stub is refused without --yes, as any destructive command is', async () => {
        const root = newProject();

        await art(['new', 'x', '--description', 'd', '--destructive'], root);

        expect((await art(['x', '--json'], root)).code).toBe(EXIT_CODE.FAILED);
    });

    test('the acceptance line: the file `art x y --help` describes, from all the options', async () => {
        const root = newProject();

        await art(
            [
                'new',
                'x',
                'y',
                '--description',
                'd',
                '--arg',
                'a',
                '--flag',
                'f',
                '--destructive',
                '--supports-dry-run'
            ],
            root
        );

        expect((await art(['x', 'y', '--help'], root)).out).toContain('x y');
    });
});
