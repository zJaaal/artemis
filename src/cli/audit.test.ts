import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
    AUDIT_FILE_NAME,
    AUDIT_MAX_BYTES,
    AUDIT_ROTATED_FILE_NAME,
    EXIT_CODE
} from '../constants.js';
import type { AuditEdges, AuditLine } from '../models.js';
import { commandSource, makeAuditProject, writeCommand } from '../test/project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { cli } from './index.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const START = Date.parse('2026-11-13T10:02:11.391Z');
const COMMAND_MS = 250;

/** A clock that says START the first time and START + COMMAND_MS after: a run lasts exactly that. */
const steppedClock = (): (() => number) => {
    const calls: number[] = [];

    return () => {
        calls.push(calls.length);

        return START + (calls.length > 1 ? COMMAND_MS : 0);
    };
};

const art = async (argv: string[], cwd: string, audit?: Partial<AuditEdges>) => {
    const stdout = createSink();
    const stderr = createSink();

    const code = await cli({
        argv,
        cwd,
        stdout,
        stderr,
        env: {},
        interactive: false,
        color: false,
        audit: { now: steppedClock(), ...audit }
    });

    return { code, out: stdout.text, err: stderr.text };
};

const projectRoot = (manifest: Record<string, unknown> = {}): string => {
    const root = folders.make('artemis-audit-');

    return makeAuditProject(root, manifest);
};

const trailOf = (root: string, name = AUDIT_FILE_NAME): AuditLine[] => {
    const file = path.join(root, 'state', name);

    return fs.existsSync(file)
        ? fs
              .readFileSync(file, 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line) as AuditLine)
        : [];
};

describe('the audit trail: one line per run of a project command', () => {
    test('a successful run has every field', async () => {
        const root = projectRoot();

        await art(['greet', 'ana', '--json'], root);

        expect(trailOf(root)).toEqual([
            {
                time: '2026-11-13T10:02:11.391Z',
                command: 'greet',
                argv: ['ana'],
                ran: true,
                dryRun: false,
                yes: false,
                exitCode: EXIT_CODE.OK,
                ms: COMMAND_MS
            }
        ]);
    });

    test('an alias is recorded as the id of its command', async () => {
        const root = projectRoot();

        await art(['hi', '--json'], root);

        expect(trailOf(root)[0]?.command).toBe('greet');
    });

    test('argv is what followed the command, without any global flag or the value of --log', async () => {
        const root = projectRoot();

        await art(['--json', 'greet', 'ana', '--log', 'x.log', '-y', '--quiet'], root);

        expect(trailOf(root)[0]).toMatchObject({ argv: ['ana'], yes: true });
    });

    test('argv keeps -- and what follows it, even a flag-looking word', async () => {
        const root = projectRoot();

        await art(['greet', '--json', '--', '--json'], root);

        expect(trailOf(root)[0]?.argv).toEqual(['--', '--json']);
    });

    test('a failure has the exit code and the error message', async () => {
        const root = projectRoot();

        await art(['boom', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({
            ran: true,
            exitCode: EXIT_CODE.FAILED,
            error: 'it failed'
        });
    });

    test('a dry run has the plan and dryRun true', async () => {
        const root = projectRoot();

        await art(['db', 'reset', '--dry-run', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({
            command: 'db reset',
            ran: true,
            dryRun: true,
            plan: ['delete .data/db.json']
        });
    });

    test('a run that is not a dry run has no plan key', async () => {
        const root = projectRoot();

        await art(['db', 'reset', '--yes', '--json'], root);

        expect(trailOf(root)[0]).not.toHaveProperty('plan');
    });

    test('a success has no error key', async () => {
        const root = projectRoot();

        await art(['greet', '--json'], root);

        expect(trailOf(root)[0]).not.toHaveProperty('error');
    });

    test('a usage error is recorded with ran false and exit 2', async () => {
        const root = projectRoot();

        await art(['greet', '--bogus', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({
            command: 'greet',
            ran: false,
            exitCode: EXIT_CODE.USAGE,
            error: expect.stringContaining('--bogus')
        });
    });

    test('a refused confirmation (no --yes, nobody to answer) is ran false, exit 1', async () => {
        const root = projectRoot();

        await art(['db', 'reset', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({ ran: false, exitCode: EXIT_CODE.FAILED });
    });

    test('--dry-run on a command that does not support it is a recorded usage error', async () => {
        const root = projectRoot();

        await art(['greet', '--dry-run', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({
            ran: false,
            dryRun: true,
            exitCode: EXIT_CODE.USAGE
        });
    });

    test('several runs are several lines, in order', async () => {
        const root = projectRoot();

        await art(['greet', 'a', '--json'], root);
        await art(['greet', 'b', '--json'], root);

        expect(trailOf(root).map((line) => line.argv)).toEqual([['a'], ['b']]);
    });
});

describe('the audit trail: flags the parser reads', () => {
    const grouped = (): string => {
        const root = projectRoot();

        writeCommand(
            path.join(root, 'commands'),
            'ship',
            commandSource(
                "flags: { force: { type: 'boolean', short: 'f' }, name: { type: 'string', short: 'n' } }"
            )
        );

        return root;
    };

    test('a grouped short flag (-fy) is yes: true, as the run saw it', async () => {
        const root = grouped();

        await art(['ship', '-fy', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({ yes: true, argv: ['-fy'] });
    });

    test('a grouped short flag does not turn yes on when it is not there (-f)', async () => {
        const root = grouped();

        await art(['ship', '-f', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({ yes: false });
    });

    test('a string flag whose value spells global letters keeps its word (-nyes)', async () => {
        const root = grouped();

        await art(['ship', '-nyes', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({ yes: false, argv: ['-nyes'] });
    });

    test('a group with a value that spells global letters keeps its word (-fnhey)', async () => {
        const root = grouped();

        await art(['ship', '-fnhey', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({ yes: false, argv: ['-fnhey'] });
    });

    test('--log and its value are not in argv, nor is -y', async () => {
        const root = grouped();

        await art(['ship', '--log', 'x.log', '-y', '--json', 'target'], root);

        expect(trailOf(root)[0]).toMatchObject({ argv: ['target'], yes: true });
    });

    test('a usage error drops only whole global words and never touches a group', async () => {
        const root = grouped();

        await art(['ship', '-fy', '--bogus', '--yes', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({ ran: false, argv: ['-fy', '--bogus'] });
    });

    test('a usage error falls back to the words typed', async () => {
        const root = grouped();

        await art(['ship', '--bogus', '--yes', '--dry-run', '--json'], root);

        expect(trailOf(root)[0]).toMatchObject({ ran: false, yes: true, dryRun: true });
    });
});

describe('the audit trail: what is not recorded', () => {
    test.each([
        ['--help on a command', ['greet', '--help']],
        ['help itself', ['help']],
        ['help --json --brief', ['help', '--json', '--brief']],
        ['a topic', ['db']],
        ['a built-in word', ['doctor', '--json']],
        ['an unknown command', ['nope', '--json']]
    ])('%s', async (_name, argv) => {
        const root = projectRoot();

        await art(argv, root);

        expect(trailOf(root)).toEqual([]);
    });

    test('a command run through ctx.invoke is not a separate line', async () => {
        const root = projectRoot();

        fs.writeFileSync(
            path.join(root, 'commands', 'both.js'),
            `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Runs greet',
    run: ({ ctx }) => ctx.invoke('greet', ['x'])
});
`
        );

        await art(['both', '--json'], root);

        expect(trailOf(root).map((line) => line.command)).toEqual(['both']);
    });
});

describe('the audit trail: settings', () => {
    test('"audit": false turns it off', async () => {
        const root = projectRoot({ artemis: { audit: false } });

        await art(['greet', '--json'], root);

        expect(trailOf(root)).toEqual([]);
    });

    test('"audit": true records', async () => {
        const root = projectRoot({ artemis: { audit: true } });

        await art(['greet', '--json'], root);

        expect(trailOf(root)).toHaveLength(1);
    });

    test('a value that is not a boolean is a configuration error naming the key', async () => {
        const root = projectRoot({ artemis: { audit: 'no' } });
        const result = await art(['greet', '--json'], root);

        expect(JSON.parse(result.out)).toMatchObject({
            ok: false,
            error: expect.stringContaining('"artemis".audit must be true or false')
        });
    });

    test('it is written under the stateDir of the project', async () => {
        const root = projectRoot({ artemis: { stateDir: 'data/state' } });

        await art(['greet', '--json'], root);

        expect(fs.existsSync(path.join(root, 'data', 'state', AUDIT_FILE_NAME))).toBe(true);
    });
});

describe('the audit trail: a published tool does not audit', () => {
    test('cli({ root }) writes nothing', async () => {
        const root = projectRoot({ bin: { tool: 'bin/tool.js' } });

        fs.mkdirSync(path.join(root, 'bin'));
        fs.writeFileSync(path.join(root, 'bin', 'tool.js'), '');

        const code = await cli({
            argv: ['greet', '--json'],
            root: path.join(root, 'bin', 'tool.js'),
            stdout: createSink(),
            stderr: createSink(),
            env: {},
            interactive: false,
            color: false
        });

        expect([code, trailOf(root)]).toEqual([EXIT_CODE.OK, []]);
    });
});

describe('the audit trail: rotation and failed writes', () => {
    test('a file past the limit is renamed to audit.1.jsonl and a new one starts', async () => {
        const root = projectRoot();
        const file = path.join(root, 'state', AUDIT_FILE_NAME);

        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${'x'.repeat(AUDIT_MAX_BYTES + 1)}\n`);

        await art(['greet', '--json'], root);

        expect([
            trailOf(root).length,
            fs.existsSync(path.join(root, 'state', AUDIT_ROTATED_FILE_NAME))
        ]).toEqual([1, true]);
    });

    test('an older audit.1.jsonl is replaced', async () => {
        const root = projectRoot();
        const folder = path.join(root, 'state');

        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, AUDIT_ROTATED_FILE_NAME), 'old\n');

        fs.writeFileSync(
            path.join(folder, AUDIT_FILE_NAME),
            `${'y'.repeat(AUDIT_MAX_BYTES + 1)}\n`
        );

        await art(['greet', '--json'], root);

        expect(fs.readFileSync(path.join(folder, AUDIT_ROTATED_FILE_NAME), 'utf8')).toMatch(/^y+/);
    });

    test('a file at the limit is not rotated yet', async () => {
        const root = projectRoot();
        const folder = path.join(root, 'state');

        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, AUDIT_FILE_NAME), 'z'.repeat(AUDIT_MAX_BYTES));

        await art(['greet', '--json'], root);

        expect(fs.existsSync(path.join(folder, AUDIT_ROTATED_FILE_NAME))).toBe(false);
    });

    const failing: Partial<AuditEdges> = {
        append: () => {
            throw new Error('disk full');
        }
    };

    test('a failed write warns on stderr and keeps the exit code and the envelope', async () => {
        const root = projectRoot();
        const result = await art(['greet', '--json'], root, failing);

        expect([result.code, JSON.parse(result.out).ok, result.err]).toEqual([
            EXIT_CODE.OK,
            true,
            expect.stringContaining('could not write the audit trail')
        ]);
    });

    test('--quiet hides the warning', async () => {
        const root = projectRoot();

        expect((await art(['greet', '--json', '--quiet'], root, failing)).err).toBe('');
    });

    test('a failed write does not turn a failure into another exit code', async () => {
        const root = projectRoot();

        expect((await art(['boom', '--json'], root, failing)).code).toBe(EXIT_CODE.FAILED);
    });

    test('the line is written after the envelope is printed', async () => {
        const root = projectRoot();
        const order: string[] = [];
        const stdout = { write: () => order.push('stdout') };

        await cli({
            argv: ['greet', '--json'],
            cwd: root,
            stdout,
            stderr: createSink(),
            env: {},
            interactive: false,
            color: false,
            audit: { append: () => order.push('audit') }
        });

        expect(order).toEqual(['stdout', 'audit']);
    });
});

describe('art state ignores the audit files', () => {
    test('they are not documents', async () => {
        const root = projectRoot();

        await art(['greet', '--json'], root);

        const result = await art(['state', '--json'], root);

        expect(JSON.parse(result.out).result.documents).toEqual([]);
    });
});
