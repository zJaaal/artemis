import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { AUDIT_FILE_NAME, EXIT_CODE } from '../constants.js';
import type { AuditLine } from '../models.js';
import { makeAuditProject } from '../test/project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { HISTORY_DEFAULT_LIMIT, HISTORY_USAGE_LINE } from './constants.js';
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

const newProject = (): string => makeAuditProject(folders.make('artemis-history-'));

const line = (overrides: Partial<AuditLine>): AuditLine => ({
    time: '2026-11-13T10:00:00.000Z',
    command: 'greet',
    argv: [],
    ran: true,
    dryRun: false,
    yes: false,
    exitCode: 0,
    ms: 10,
    ...overrides
});

const writeTrail = (root: string, lines: readonly (AuditLine | string)[]): void => {
    const file = path.join(root, 'state', AUDIT_FILE_NAME);

    fs.mkdirSync(path.dirname(file), { recursive: true });

    fs.writeFileSync(
        file,
        `${lines.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n')}\n`
    );
};

const entriesOf = (out: string): AuditLine[] => JSON.parse(out).result.entries as AuditLine[];

describe('art history: reading the trail', () => {
    test('a run leaves a line that history --json returns', async () => {
        const root = newProject();

        await art(['greet', 'ana', '--json'], root);

        const entries = entriesOf((await art(['history', '--json'], root)).out);

        expect(entries.map((entry) => [entry.command, entry.argv])).toEqual([['greet', ['ana']]]);
    });

    test('no audit file is an empty list', async () => {
        expect(entriesOf((await art(['history', '--json'], newProject())).out)).toEqual([]);
    });

    test('no audit file says so in text', async () => {
        expect((await art(['history'], newProject())).out).toBe('Nothing recorded yet.\n');
    });

    test('the result has the entries and the number of lines skipped', async () => {
        const root = newProject();

        writeTrail(root, [line({}), 'not json', '{"time":1}']);

        expect(JSON.parse((await art(['history', '--json'], root)).out).result).toMatchObject({
            skipped: 2,
            entries: [{ command: 'greet' }]
        });
    });

    test('the entries are the audit lines as written', async () => {
        const root = newProject();
        const written = line({ command: 'db reset', plan: ['delete x'], dryRun: true });

        writeTrail(root, [written]);

        expect(entriesOf((await art(['history', '--json'], root)).out)).toEqual([written]);
    });

    test('the newest runs come first', async () => {
        const root = newProject();

        writeTrail(root, [line({ time: 't1' }), line({ time: 't2' })]);

        expect(entriesOf((await art(['history', '--json'], root)).out).map((e) => e.time)).toEqual([
            't2',
            't1'
        ]);
    });

    test('shows at most the default number of runs', async () => {
        const root = newProject();

        writeTrail(
            root,
            Array.from({ length: HISTORY_DEFAULT_LIMIT + 5 }, () => line({}))
        );

        expect(entriesOf((await art(['history', '--json'], root)).out)).toHaveLength(
            HISTORY_DEFAULT_LIMIT
        );
    });

    test('--limit says how many', async () => {
        const root = newProject();

        writeTrail(root, [line({}), line({}), line({})]);

        expect(
            entriesOf((await art(['history', '--limit', '2', '--json'], root)).out)
        ).toHaveLength(2);
    });

    test('a bad --limit is a usage error', async () => {
        expect((await art(['history', '--limit', '0'], newProject())).code).toBe(EXIT_CODE.USAGE);
    });

    test('text is one line per run', async () => {
        const root = newProject();

        writeTrail(root, [line({ argv: ['ana'] }), line({ dryRun: true, command: 'db reset' })]);

        expect((await art(['history'], root)).out).toBe(
            '2026-11-13T10:00:00.000Z  db reset  dry run\n2026-11-13T10:00:00.000Z  greet  exit 0  ana\n'
        );
    });
});

describe('art history: the filter', () => {
    test('several words are one command id', async () => {
        const root = newProject();

        writeTrail(root, [line({ command: 'greet' }), line({ command: 'db reset' })]);

        expect(
            entriesOf((await art(['history', 'db', 'reset', '--json'], root)).out).map(
                (e) => e.command
            )
        ).toEqual(['db reset']);
    });

    test('an alias is the id of its command', async () => {
        const root = newProject();

        writeTrail(root, [line({ command: 'greet' }), line({ command: 'db reset' })]);

        expect(
            entriesOf((await art(['history', 'hi', '--json'], root)).out).map((e) => e.command)
        ).toEqual(['greet']);
    });

    test('an id that no longer exists still matches exactly', async () => {
        const root = newProject();

        writeTrail(root, [line({ command: 'gone thing' })]);

        expect(
            entriesOf((await art(['history', 'gone', 'thing', '--json'], root)).out)
        ).toHaveLength(1);
    });

    test('commands that do not load do not hide the history', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'commands', 'broken.js'), 'export default 1;\n');
        writeTrail(root, [line({ command: 'greet' })]);

        expect((await art(['history', 'greet', '--json'], root)).code).toBe(EXIT_CODE.OK);
    });
});

describe('art history: a word of the shipped binary', () => {
    test('is listed under builtins', async () => {
        const result = JSON.parse((await art(['help', '--json'], newProject())).out).result;

        expect(result.builtins.map((builtin: { id: string }) => builtin.id)).toContain('history');
    });

    test('--help --json prints its manifest entry', async () => {
        const result = await art(['history', '--help', '--json'], newProject());

        expect(JSON.parse(result.out)).toMatchObject({
            ok: true,
            command: 'history',
            result: { id: 'history', usage: HISTORY_USAGE_LINE }
        });
    });

    test('--help prints its usage text', async () => {
        expect((await art(['history', '--help'], newProject())).out).toContain(
            `Usage: ${HISTORY_USAGE_LINE}`
        );
    });

    test.each(['--dry-run', '--log'])('refuses %s with exit 2', async (flag) => {
        expect((await art(['history', flag, 'x'], newProject())).code).toBe(EXIT_CODE.USAGE);
    });

    test('accepts --quiet', async () => {
        expect((await art(['history', '--quiet'], newProject())).code).toBe(EXIT_CODE.OK);
    });

    test('a project command called history is hidden, and the shadow is warned about', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'commands', 'history.js'), 'export default 1;\n');

        expect((await art(['history'], root)).err).toContain('hides it');
    });

    test('--quiet hides that warning', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'commands', 'history.js'), 'export default 1;\n');

        expect((await art(['history', '--quiet'], root)).err).toBe('');
    });

    test('works from a folder inside the project', async () => {
        const root = newProject();

        fs.mkdirSync(path.join(root, 'src'));

        expect((await art(['history'], path.join(root, 'src'))).code).toBe(EXIT_CODE.OK);
    });

    test('outside a project it fails with a hint', async () => {
        const result = await art(['history', '--json'], folders.make('artemis-nowhere-'));

        expect(JSON.parse(result.out)).toMatchObject({ ok: false });
    });

    test('a flag before the word that is not global is refused', async () => {
        expect((await art(['--limit', 'history'], newProject())).code).toBe(EXIT_CODE.USAGE);
    });
});
