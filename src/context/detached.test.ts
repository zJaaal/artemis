import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { art, envelope } from '../test/art.js';
import { writeCommand } from '../test/project.js';
import { createTempFolders } from '../test/temp.js';
import { assertExecOptions, detachedPlannedLine, isDetachedOptions } from './exec.js';

const folders = createTempFolders();
const started: number[] = [];

afterEach(() => {
    started.splice(0).forEach((pid) => {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch {
            // ESRCH: it is already gone
        }
    });

    folders.cleanUp();
});

const WAIT_MS = 5000;
const POLL_MS = 20;
const SILENT_JOB = 'setInterval(() => {}, 1000)';
const PRINTING_JOB = "console.log('from the child'); setInterval(() => {}, 1000)";

const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        // ESRCH: there is no such process any more
        return false;
    }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForText(file: string, text: string): Promise<string> {
    for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
        const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

        if (content.includes(text)) {
            return content;
        }

        await sleep(POLL_MS);
    }

    return '';
}

const logOf = (): string => path.join(folders.make('artemis-detached-'), 'child.log');

const pidOf = (out: string): number => {
    const { pid } = envelope({ code: 0, out, err: '' }).result as { pid: number };

    started.push(pid);

    return pid;
};

describe('ctx.exec detached: through a command', () => {
    test('resolves with a pid while the child keeps running after the command ended', async () => {
        const run = await art(['exec-detached', SILENT_JOB, logOf(), '--json']);

        expect(isAlive(pidOf(run.out))).toBe(true);
    });

    test('the result is { pid, skipped: false }', async () => {
        const run = await art(['exec-detached', SILENT_JOB, logOf(), '--json']);

        expect(envelope(run).result).toEqual({ pid: pidOf(run.out), skipped: false });
    });

    test('the log file gets the output of the child', async () => {
        const log = logOf();

        const run = await art(['exec-detached', PRINTING_JOB, log, '--json']);

        pidOf(run.out);

        expect(await waitForText(log, 'from the child')).toContain('from the child');
    });

    test('its output never reaches the terminal nor the --log file', async () => {
        const log = logOf();
        const runLog = path.join(path.dirname(log), 'run.log');

        const run = await art(['exec-detached', PRINTING_JOB, log, '--log', runLog]);

        await waitForText(log, 'from the child');

        expect([run.out, run.err, fs.readFileSync(runLog, 'utf8')]).toEqual(['', '', '']);
    });

    test('a folder that does not exist is the usual missing-folder error', async () => {
        const run = await art([
            'exec-detached',
            SILENT_JOB,
            logOf(),
            '--cwd',
            path.join(folders.make('artemis-detached-'), 'typo'),
            '--json'
        ]);

        expect(envelope(run)).toMatchObject({
            ok: false,
            error: expect.stringMatching(/does not exist/)
        });
    });

    test('a folder that is a file says it is not a folder, naming it', async () => {
        const file = path.join(folders.make('artemis-detached-'), 'plain.txt');

        fs.writeFileSync(file, 'x');

        const run = await art(['exec-detached', SILENT_JOB, logOf(), '--cwd', file, '--json']);

        expect(envelope(run)).toMatchObject({
            ok: false,
            error: `${file} is not a folder`
        });
    });

    test('under --dry-run it is planned and nothing starts', async () => {
        const log = logOf();
        const run = await art(['exec-detached', SILENT_JOB, log, '--dry-run', '--json']);

        expect(envelope(run)).toMatchObject({
            ok: true,
            result: { pid: null, skipped: true },
            plan: [expect.stringMatching(new RegExp(`in the background, output in .*child\\.log`))]
        });
    });

    test('under --dry-run the log file is not created', async () => {
        const log = logOf();

        await art(['exec-detached', SILENT_JOB, log, '--dry-run']);

        expect(fs.existsSync(log)).toBe(false);
    });
});

describe('ctx.exec detached: bad calls are a TypeError, a dry run included', () => {
    const callWith = async (options: string, ...flags: string[]) => {
        const dir = path.join(folders.make('artemis-detached-'), 'commands');

        writeCommand(
            dir,
            'bad',
            `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'A bad call',
    dryRun: true,
    async run({ ctx }) {
        try {
            await ctx.exec('node', [], ${options});
        } catch (error) {
            return { name: error.name, message: error.message };
        }

        return { name: 'none' };
    }
});
`
        );

        return art(['bad', '--json', ...flags], { commandsDir: dir });
    };

    const nameOf = (out: string): unknown =>
        (envelope({ code: 0, out, err: '' }).result as { name: string }).name;

    test.each([
        ['an empty logFile', "{ detached: true, logFile: '' }"],
        ['no logFile', '{ detached: true }'],
        ['capture', "{ detached: true, logFile: 'a.log', capture: true }"],
        ['readOnly', "{ detached: true, logFile: 'a.log', readOnly: true }"],
        ['timeoutMs', "{ detached: true, logFile: 'a.log', timeoutMs: 10 }"],
        ['reject', "{ detached: true, logFile: 'a.log', reject: false }"],
        ['errorPattern', "{ detached: true, logFile: 'a.log', errorPattern: /x/ }"],
        ['a logFile without detached', "{ logFile: 'a.log' }"],
        ['a logFile with detached false', "{ detached: false, logFile: 'a.log' }"]
    ])('%s rejects with a TypeError', async (_name, options) => {
        expect(nameOf((await callWith(options)).out)).toBe('TypeError');
    });

    test('a TypeError is found under --dry-run too', async () => {
        expect(nameOf((await callWith("{ detached: true, logFile: '' }", '--dry-run')).out)).toBe(
            'TypeError'
        );
    });

    test('an option set to undefined is the same as no option', async () => {
        const run = await callWith(
            "{ detached: true, logFile: 'a.log', capture: undefined }",
            '--dry-run'
        );

        expect(nameOf(run.out)).toBe('none');
        expect(run.code).toBe(EXIT_CODE.OK);
    });
});

describe('the pure checks of a detached call', () => {
    test('detached: true is a detached call', () => {
        expect(isDetachedOptions({ detached: true, logFile: 'a.log' })).toBe(true);
    });

    test('options without detached are not', () => {
        expect(isDetachedOptions({ capture: true })).toBe(false);
    });

    test('valid detached options are accepted', () => {
        expect(() =>
            assertExecOptions({ detached: true, logFile: 'a.log', cwd: '.' })
        ).not.toThrow();
    });

    test('the plan line names the command, its arguments and the log file', () => {
        expect(detachedPlannedLine('npm', ['run', 'dev'], 'dev.log')).toBe(
            'start npm run dev in the background, output in dev.log'
        );
    });
});
