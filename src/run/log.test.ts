import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { EXEC_NO_LOG_HINT, EXIT_CODE, LOG_FILE_HINT } from '../constants.js';
import { art, envelope } from '../test/art.js';
import { createTempFolders } from '../test/temp.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const newLog = (name = 'run.log'): string => path.join(folders.make('artemis-run-log-'), name);

const read = (file: string): string => fs.readFileSync(file, 'utf8');

describe('--log: what the file holds', () => {
    test('every ctx.log and ctx.warn line and all child output, even under --quiet', async () => {
        const file = newLog();

        await art(['logs', '--quiet', '--log', file]);

        expect(read(file).split('\n').sort()).toEqual(
            ['', 'child err', 'child out', 'log line', 'warn line'].sort()
        );
    });

    test('and ctx.log lines too under --json, where stdout hides them', async () => {
        const file = newLog();

        await art(['logs', '--json', '--log', file]);

        expect(read(file)).toMatch(/log line/);
    });

    test('--log=file works the same as --log file', async () => {
        const file = newLog();

        await art([`--log=${file}`, 'logs', '--quiet']);

        expect(read(file)).toMatch(/child out/);
    });

    test('the file is truncated at the start of the run', async () => {
        const file = newLog();

        fs.writeFileSync(file, 'old old old old old old old old old old old old\n');
        const run = await art(['logs', '--quiet', '--log', file]);

        expect(run.code).toBe(EXIT_CODE.OK);
        expect(read(file)).toMatch(/log line/);
        expect(read(file)).not.toMatch(/old/);
    });

    test('a command that invokes another writes into the same file, once', async () => {
        const file = newLog();

        await art(['invokes-logs', '--quiet', '--log', file]);

        expect(read(file)).toMatch(/^caller line\n.*log line/s);
    });

    test('the invoked command does not truncate what the caller already wrote', async () => {
        const file = newLog();

        await art(['invokes-logs', '--quiet', '--log', file]);

        expect(read(file)).toMatch(/caller line/);
    });
});

describe('--log: through ctx.invoke', () => {
    test("a log of its own handed to an invoked command is the caller's bug", async () => {
        const result = await art(['invokes-with-log', '--json']);

        expect(envelope(result)).toMatchObject({
            ok: false,
            error: expect.stringContaining('--log is not something a command can invoke')
        });
    });
});

describe('--log: the envelope', () => {
    test('a success names the absolute path as log, after result', async () => {
        const file = newLog();
        const result = await art(['logs', '--json', '--log', file]);

        expect(Object.keys(envelope(result))).toEqual(['ok', 'command', 'result', 'log']);
    });

    test('the log key is the absolute path', async () => {
        const file = newLog();

        expect(envelope(await art(['logs', '--json', '--log', file])).log).toBe(file);
    });

    test('a failure names it too', async () => {
        const file = newLog();
        const result = await art(['exec', 'process.exit(1)', '--json', '--log', file]);

        expect(envelope(result).log).toBe(file);
    });

    test('and its hint points at the full log instead of telling the caller to use --log', async () => {
        const file = newLog();
        const result = await art(['exec', 'process.exit(1)', '--json', '--log', file]);

        expect(envelope(result).hint).toBe(`Full log: ${file}`);
    });

    test('without --log there is no log key', async () => {
        const result = envelope(await art(['logs', '--json']));

        expect(result.ok).toBe(true);
        expect(result).not.toHaveProperty('log');
    });

    test('a failure without --log keeps the hint that says how to ask for one', async () => {
        const result = await art(['exec', 'process.exit(1)', '--json']);

        expect(envelope(result).hint).toBe(EXEC_NO_LOG_HINT);
    });
});

describe('--log: text mode shows the child as it is, and keeps a copy', () => {
    test('child stdout goes to stdout and child stderr to stderr', async () => {
        const file = newLog();
        const run = await art(['logs', '--log', file]);

        expect([run.out.includes('child out'), run.err.includes('child err')]).toEqual([
            true,
            true
        ]);
    });

    test('and the file has them both', async () => {
        const file = newLog();

        await art(['logs', '--log', file]);

        expect(read(file)).toMatch(/child out[\s\S]*child err|child err[\s\S]*child out/);
    });
});

describe('--log: when it cannot be opened', () => {
    test('a folder that does not exist fails before run, exit 1', async () => {
        const file = path.join(folders.make('artemis-run-log-'), 'missing', 'run.log');

        expect((await art(['logs', '--log', file])).code).toBe(EXIT_CODE.FAILED);
    });

    test('with the hint that says what to check', async () => {
        const file = path.join(folders.make('artemis-run-log-'), 'missing', 'run.log');

        expect(envelope(await art(['logs', '--json', '--log', file])).hint).toBe(LOG_FILE_HINT);
    });

    test('and no log key', async () => {
        const file = path.join(folders.make('artemis-run-log-'), 'missing', 'run.log');

        const result = envelope(await art(['logs', '--json', '--log', file]));

        expect(result.ok).toBe(false);
        expect(result).not.toHaveProperty('log');
    });

    test('run was never called', async () => {
        const file = path.join(folders.make('artemis-run-log-'), 'missing', 'run.log');

        const run = await art(['logs', '--log', file]);

        expect(run.code).toBe(EXIT_CODE.FAILED);
        expect(run.out).not.toMatch(/log line/);
    });
});

describe('--log: the order before run', () => {
    test('a destructive run that is refused leaves an existing log file as it was', async () => {
        const file = newLog();

        fs.writeFileSync(file, 'kept\n');
        await art(['purge', '--log', file]);

        expect(read(file)).toBe('kept\n');
    });

    test('a failed run still closes the file: it can be removed', async () => {
        const file = newLog();

        await art(['exec', 'process.exit(1)', '--log', file]);

        expect(() => fs.rmSync(file)).not.toThrow();
    });
});

describe('--quiet', () => {
    test('hides ctx.warn', async () => {
        const run = await art(['logs', '--quiet']);

        expect(run.code).toBe(EXIT_CODE.OK);
        expect(run.err).toBe('');
    });

    test('does not hide ctx.log in text mode: it is the result for people', async () => {
        expect((await art(['logs', '--quiet'])).out).toMatch(/log line/);
    });

    test('does not hide the envelope', async () => {
        expect(envelope(await art(['logs', '--json', '--quiet'])).ok).toBe(true);
    });

    test('does not hide an error', async () => {
        expect((await art(['boom', '--quiet'])).err).toMatch(/Error/);
    });

    test('with --json and a child that prints a lot, stderr stays empty', async () => {
        const script = "for (let i = 0; i < 2000; i++) console.log('line ' + i)";
        const run = await art(['exec', script, '--json', '--quiet']);

        expect(envelope(run).ok).toBe(true);
        expect(run.err).toBe('');
    });

    test('and stdout is exactly one object', async () => {
        const script = "for (let i = 0; i < 2000; i++) console.log('line ' + i)";
        const run = await art(['exec', script, '--json', '--quiet']);

        expect(() => JSON.parse(run.out)).not.toThrow();
    });
});
