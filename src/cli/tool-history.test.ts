import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { AUDIT_FILE_NAME, EXIT_CODE } from '../constants.js';
import type { AuditLine, Manifest } from '../models.js';
import type { Envelope } from '../test/models.js';
import { makeAuditProject, writeCommand } from '../test/project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { HISTORY_SHADOW_WARNING, HISTORY_WORD } from './constants.js';
import { cli } from './index.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

/** A published tool: its package.json declares the bin and, when asked, `"audit": true`. */
const makeTool = (artemis: Record<string, unknown> = {}): { root: string; binFile: string } => {
    const root = folders.make('artemis-tool-history-');

    makeAuditProject(root, {
        name: 'mytool',
        bin: { mytool: 'bin/mytool.js' },
        ...(Object.keys(artemis).length ? { artemis } : {})
    });

    return { root, binFile: path.join(root, 'bin', 'mytool.js') };
};

/** Runs the tool the way its bin file does, from nowhere in particular. */
const tool = async (argv: string[], binFile: string) => {
    const stdout = createSink();
    const stderr = createSink();

    const code = await cli({
        argv,
        root: binFile,
        stdout,
        stderr,
        env: {},
        interactive: false,
        color: false
    });

    return { code, out: stdout.text, err: stderr.text };
};

const trailFile = (root: string): string => path.join(root, 'state', AUDIT_FILE_NAME);

const envelope = (out: string): Envelope => JSON.parse(out) as Envelope;

const entriesOf = (out: string): AuditLine[] =>
    (envelope(out).result as { entries: AuditLine[] }).entries;

describe('a published tool that turns auditing on', () => {
    test('records a run in the state folder of its package', async () => {
        const { root, binFile } = makeTool({ audit: true });

        await tool(['greet', 'ana', '--json'], binFile);

        expect(fs.readFileSync(trailFile(root), 'utf8')).toContain('"command":"greet"');
    });

    test('`<bin> history --json` returns the run', async () => {
        const { binFile } = makeTool({ audit: true });

        await tool(['greet', 'ana', '--json'], binFile);

        expect(entriesOf((await tool(['history', '--json'], binFile)).out)).toMatchObject([
            { command: 'greet', argv: ['ana'], exitCode: 0 }
        ]);
    });

    test('history filters by command words and takes --limit', async () => {
        const { binFile } = makeTool({ audit: true });

        await tool(['greet', '--json'], binFile);
        await tool(['boom', '--json'], binFile);
        await tool(['greet', '--json'], binFile);

        expect(
            entriesOf((await tool(['history', 'greet', '--limit', '1', '--json'], binFile)).out)
        ).toHaveLength(1);
    });

    test('an alias of a command filters to that command', async () => {
        const { binFile } = makeTool({ audit: true });

        await tool(['greet', '--json'], binFile);
        await tool(['boom', '--json'], binFile);

        expect(
            entriesOf((await tool(['history', 'hi', '--json'], binFile)).out).map((e) => e.command)
        ).toEqual(['greet']);
    });

    test('running history is not itself recorded', async () => {
        const { root, binFile } = makeTool({ audit: true });

        await tool(['history'], binFile);

        expect(fs.existsSync(trailFile(root))).toBe(false);
    });

    test('history works with no commands folder at all', async () => {
        const { root, binFile } = makeTool({ audit: true });

        fs.rmSync(path.join(root, 'commands'), { recursive: true });

        expect((await tool(['history', '--json'], binFile)).code).toBe(EXIT_CODE.OK);
    });

    test('--help shows the tool bin in the usage line', async () => {
        const { binFile } = makeTool({ audit: true });

        expect((await tool(['history', '--help'], binFile)).out).toMatch(/^Usage: mytool history /);
    });

    test('--help --json is the manifest entry of the word', async () => {
        const { binFile } = makeTool({ audit: true });

        expect(envelope((await tool(['history', '--help', '--json'], binFile)).out)).toMatchObject({
            ok: true,
            command: 'history',
            result: { id: 'history' }
        });
    });

    test.each(['--dry-run', '--log'])('refuses %s with exit 2', async (flag) => {
        const { binFile } = makeTool({ audit: true });

        expect((await tool(['history', flag, 'x'], binFile)).code).toBe(EXIT_CODE.USAGE);
    });

    test('a flag before the word that is not global is refused', async () => {
        const { binFile } = makeTool({ audit: true });

        expect((await tool(['--limit', 'history'], binFile)).code).toBe(EXIT_CODE.USAGE);
    });

    test('an invalid "audit" value is a setup failure naming package.json', async () => {
        const { binFile } = makeTool({ audit: 'yes' });
        const result = await tool(['history', '--json'], binFile);

        expect(envelope(result.out)).toMatchObject({
            ok: false,
            error: expect.stringContaining('"artemis".audit must be true or false')
        });
    });
});

describe('a published tool that turns auditing on: its help', () => {
    test('the brief listing has builtins: ["history"]', async () => {
        const { binFile } = makeTool({ audit: true });
        const brief = envelope((await tool(['help', '--brief', '--json'], binFile)).out).result;

        expect((brief as { builtins: string[] }).builtins).toEqual([HISTORY_WORD]);
    });

    test('help --json has builtins with the history entry', async () => {
        const { binFile } = makeTool({ audit: true });
        const full = envelope((await tool(['help', '--json'], binFile)).out).result as Manifest;

        expect(full.builtins?.map((builtin) => builtin.id)).toEqual([HISTORY_WORD]);
    });

    test('help history --json prints that entry', async () => {
        const { binFile } = makeTool({ audit: true });
        const result = envelope((await tool(['help', 'history', '--json'], binFile)).out);

        expect(result.result).toMatchObject({ id: 'history' });
    });

    test('text help lists the word under Built-in', async () => {
        const { binFile } = makeTool({ audit: true });

        expect((await tool(['help'], binFile)).out).toMatch(/Built-in[\s\S]*history/);
    });
});

describe('a published tool that does not turn auditing on', () => {
    test('writes no file', async () => {
        const { root, binFile } = makeTool();

        await tool(['greet', '--json'], binFile);

        expect(fs.existsSync(trailFile(root))).toBe(false);
    });

    test('has no history word: it is an unknown command', async () => {
        const { binFile } = makeTool();

        expect((await tool(['history'], binFile)).code).toBe(EXIT_CODE.USAGE);
    });

    test('has no builtins key in help --json', async () => {
        const { binFile } = makeTool();
        const full = envelope((await tool(['help', '--json'], binFile)).out).result as Manifest;

        expect(full).not.toHaveProperty('builtins');
    });

    test('"audit": false writes nothing and reserves nothing either', async () => {
        const { root, binFile } = makeTool({ audit: false });

        await tool(['greet', '--json'], binFile);

        expect(fs.existsSync(trailFile(root))).toBe(false);
    });

    test('a command called history still runs', async () => {
        const { root, binFile } = makeTool();

        writeCommand(
            path.join(root, 'commands'),
            'history',
            "import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'Mine', run: () => ({ mine: true }) });\n"
        );

        expect(envelope((await tool(['history', '--json'], binFile)).out).result).toEqual({
            mine: true
        });
    });
});

describe('a published tool with auditing and a command called history', () => {
    const toolWithHistoryCommand = () => {
        const made = makeTool({ audit: true });

        writeCommand(
            path.join(made.root, 'commands'),
            'history',
            "import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'Mine', run: () => ({ mine: true }) });\n"
        );

        return made.binFile;
    };

    test('the word wins over the command', async () => {
        const result = await tool(['history', '--json'], toolWithHistoryCommand());

        expect(envelope(result.out).result).toMatchObject({ entries: [] });
    });

    test('and says so on stderr, with the shipped warning text', async () => {
        const result = await tool(['history', '--json'], toolWithHistoryCommand());

        expect(result.err).toContain(HISTORY_SHADOW_WARNING);
    });

    test('--quiet hides the warning', async () => {
        const result = await tool(['history', '--quiet'], toolWithHistoryCommand());

        expect(result.err).toBe('');
    });
});
