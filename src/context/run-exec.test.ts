import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
    EXEC_NO_LOG_HINT,
    EXEC_NOT_FOUND_HINT,
    EXEC_TAIL_LINE_CHARS,
    EXEC_TAIL_LINES,
    EXIT_CODE
} from '../constants.js';
import { art, envelope } from '../test/art.js';
import { createSink } from '../test/sink.js';
import { failure } from './run-exec.js';
import { createTempFolders } from '../test/temp.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const HELLO_SCRIPT = "process.stdout.write('hi\\n')";
const NOISY_FAILURE = "for (let i = 1; i <= 100; i++) console.log('line ' + i); process.exit(1)";
const FOREVER_SCRIPT = 'setInterval(() => {}, 1000)';
const SHORT_TIMEOUT_MS = '100';
const LONG_LINE_LENGTH = 1000;
const POLL_MS = 20;
const WAIT_MS = 5000;

const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        // ESRCH: there is no such process any more, which is the answer
        return false;
    }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits (bounded) until the process is gone, so a test never depends on how fast a kill lands. */
const gone = async (pid: number): Promise<boolean> => {
    for (let waited = 0; waited < WAIT_MS && isAlive(pid); waited += POLL_MS) {
        await sleep(POLL_MS);
    }

    return !isAlive(pid);
};

const result = (out: string) =>
    envelope({ code: 0, out, err: '' }).result as Record<string, unknown>;

describe('ctx.exec: what it returns', () => {
    test('capture returns the output instead of showing it', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--capture', '--json']);

        expect(result(run.out)).toEqual({ code: 0, output: 'hi\n', skipped: false });
    });

    test('capture shows nothing on stderr', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--capture', '--json']);

        expect(envelope(run).ok).toBe(true);
        expect(run.err).toBe('');
    });

    test('capture still returns the output under --json and --quiet (the first row wins)', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--capture', '--json', '--quiet']);

        expect(result(run.out).output).toBe('hi\n');
    });

    test('--json shows the child on stderr, so stdout stays one object', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--json']);

        expect(run.err).toBe('hi\n');
    });

    test('--json keeps stdout to exactly one object', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--json']);

        expect(() => JSON.parse(run.out)).not.toThrow();
    });

    test('--quiet shows nothing at all', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--quiet']);

        expect([run.out, run.err]).toEqual(['', '']);
    });

    test('a non-zero exit with reject: false returns the code', async () => {
        const run = await art(['exec', 'process.exit(4)', '--no-reject', '--json']);

        expect(result(run.out)).toMatchObject({ code: 4, skipped: false });
    });
});

describe('ctx.exec: a child that fails', () => {
    test('fails the command with exit 1 and names the command and the code', async () => {
        const run = await art(['exec', 'process.exit(3)', '--json']);

        expect(envelope(run)).toMatchObject({
            ok: false,
            error: expect.stringMatching(/exited with code 3/)
        });
    });

    test('exits 1', async () => {
        expect((await art(['exec', 'process.exit(3)', '--json'])).code).toBe(EXIT_CODE.FAILED);
    });

    test('the envelope carries the last lines, at most EXEC_TAIL_LINES', async () => {
        const failure = envelope(await art(['exec', NOISY_FAILURE, '--json']));

        expect(failure.tail).toHaveLength(EXEC_TAIL_LINES);
    });

    test('the tail ends with the last line the child printed', async () => {
        const failure = envelope(await art(['exec', NOISY_FAILURE, '--json']));

        expect(failure.tail?.at(-1)).toBe('line 100');
    });

    test('each tail line is cut at EXEC_TAIL_LINE_CHARS', async () => {
        const script = `console.log('x'.repeat(${LONG_LINE_LENGTH})); process.exit(1)`;
        const failure = envelope(await art(['exec', script, '--json']));

        expect(failure.tail?.[0]).toHaveLength(EXEC_TAIL_LINE_CHARS);
    });

    test('without --log the hint says how to keep the full output', async () => {
        expect(envelope(await art(['exec', 'process.exit(1)', '--json'])).hint).toBe(
            EXEC_NO_LOG_HINT
        );
    });

    test('a child with no output has no tail key', async () => {
        const result = envelope(await art(['exec', 'process.exit(1)', '--json']));

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringMatching(/exited with code 1/)
        });

        expect(result).not.toHaveProperty('tail');
    });

    test('a missing executable is "<command> was not found" with a hint', async () => {
        const failure = envelope(
            await art(['exec', 'x', '--command', 'artemis-no-such-program', '--json'])
        );

        expect(failure).toMatchObject({
            error: 'artemis-no-such-program was not found',
            hint: EXEC_NOT_FOUND_HINT
        });
    });

    test('a timeout kills the child and fails with the time in seconds', async () => {
        const run = await art(['exec', FOREVER_SCRIPT, '--timeout', SHORT_TIMEOUT_MS, '--json']);

        expect(envelope(run).error).toMatch(/took longer than 0.1 s/);
    });

    test('a timeout throws even with reject: false', async () => {
        const run = await art([
            'exec',
            FOREVER_SCRIPT,
            '--timeout',
            SHORT_TIMEOUT_MS,
            '--no-reject',
            '--json'
        ]);

        expect(envelope(run).ok).toBe(false);
    });

    test('in text mode, hidden output is printed under the error so a person sees why it failed', async () => {
        const run = await art(['exec', NOISY_FAILURE, '--quiet']);

        expect(run.err).toMatch(/Error: .*exited with code 1[\s\S]*line 100/);
    });

    test('under --json the tail is only in the envelope, never printed as text', async () => {
        const run = await art(['exec', NOISY_FAILURE, '--json']);

        expect(envelope(run)).toMatchObject({ ok: false, tail: expect.any(Array) });
        expect(run.out).not.toMatch(/Error:/);
    });
});

describe('ctx.exec: what it keeps in memory', () => {
    test('output is returned only to a call that asked for it', async () => {
        const run = await art(['exec', 'console.log("hi")', '--quiet', '--json']);

        expect(envelope(run).result).toMatchObject({ output: '' });
    });

    test('a capture call gets it', async () => {
        const run = await art(['exec', 'console.log("hi")', '--capture', '--json']);

        expect(envelope(run).result).toMatchObject({ output: 'hi\n' });
    });
});

describe('ctx.exec: a call nobody awaits', () => {
    test('that fails on its own does not take the run down', async () => {
        const run = await art(['exec-fails-alone', '--json']);

        expect(envelope(run)).toMatchObject({ ok: true, result: { done: true } });
    });
});

describe('ctx.exec: where a child starts', () => {
    test('is the folder the run was given, not the one of the process', async () => {
        const cwd = fs.realpathSync(folders.make('artemis-exec-cwd-'));

        const run = await art(['exec', 'console.log(process.cwd())', '--capture', '--json'], {
            cwd
        });

        expect(String(result(run.out).output).trim()).toBe(cwd);
    });
});

describe('ctx.exec: a child killed by a signal', () => {
    test('names the signal, not an exit code', async () => {
        const run = await art(['exec', "process.kill(process.pid, 'SIGKILL')", '--json']);

        expect(envelope(run)).toMatchObject({
            ok: false,
            error: expect.stringContaining('was killed by SIGKILL')
        });
    });
});

describe('ctx.exec: a program that cannot be started', () => {
    test('is its own error with the cause, and fails even with reject: false', async () => {
        const script = path.join(folders.make('artemis-exec-'), 'run.sh');

        fs.writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o644 });

        const run = await art(['exec', 'unused', '--command', script, '--no-reject', '--json']);

        expect(envelope(run)).toMatchObject({
            ok: false,
            error: expect.stringContaining('could not be started')
        });
    });
});

describe('ctx.exec: a folder that does not exist', () => {
    test('is its own error naming the folder, not "exited with code 1"', async () => {
        const cwd = path.join(folders.make('artemis-exec-cwd-'), 'typo');
        const run = await art(['exec', 'process.exit(0)', '--cwd', cwd, '--json']);

        expect(envelope(run)).toMatchObject({
            ok: false,
            error: `The folder ${cwd} does not exist`
        });
    });

    test('names the resolved folder, not the relative one typed', async () => {
        const root = folders.make('artemis-exec-cwd-');

        const run = await art(['exec', 'process.exit(0)', '--cwd', 'typo', '--json'], {
            cwd: root
        });

        expect(envelope(run).error).toBe(`The folder ${path.join(root, 'typo')} does not exist`);
    });

    test('fails even with reject: false, where a plain exit code is returned', async () => {
        const cwd = path.join(folders.make('artemis-exec-cwd-'), 'typo');
        const run = await art(['exec', 'process.exit(0)', '--cwd', cwd, '--no-reject', '--json']);

        expect(envelope(run).ok).toBe(false);
    });
});

describe('ctx.exec under --dry-run', () => {
    test('starts no process: it is skipped and says so', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--dry-run', '--json']);

        expect(result(run.out)).toEqual({ code: 0, output: '', skipped: true });
    });

    test('adds the command line to the plan, with no folder when none was given', async () => {
        const run = await art(['exec', 'x', '--command', 'docker', '--dry-run', '--json']);

        expect(envelope(run).plan).toEqual(['docker']);
    });

    test('adds the folder to the plan line when one was given', async () => {
        const run = await art([
            'exec',
            'x',
            '--command',
            'docker',
            '--cwd',
            '/srv/app',
            '--dry-run',
            '--json'
        ]);

        expect(envelope(run).plan).toEqual(['docker (in /srv/app)']);
    });

    test('a readOnly call runs for real, captured', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--read-only', '--dry-run', '--json']);

        expect(result(run.out)).toEqual({ code: 0, output: 'hi\n', skipped: false });
    });

    test('a readOnly call adds nothing to the plan', async () => {
        const run = await art(['exec', HELLO_SCRIPT, '--read-only', '--dry-run', '--json']);

        expect(envelope(run).plan).toEqual([]);
    });
});

describe('ctx.exec: a child a command leaves running', () => {
    test('both children are killed when run throws, before the run ends', async () => {
        const dir = folders.make('artemis-exec-run-');
        const first = path.join(dir, 'first.pid');
        const second = path.join(dir, 'second.pid');

        const run = await art(['exec-leaves', first, second, '--json']);
        const pids = [first, second].map((file) => Number(fs.readFileSync(file, 'utf8')));

        expect(envelope(run).ok).toBe(false);
        expect(await Promise.all(pids.map(gone))).toEqual([true, true]);
    });
});

describe('ctx.exec: a program that was not found and was stopped by the run', () => {
    const run = {
        io: { stdout: createSink(), stderr: createSink() },
        global: {
            help: false,
            json: false,
            yes: false,
            dryRun: false,
            quiet: false,
            log: undefined
        },
        log: undefined,
        children: new Set<never>(),
        plan: []
    };

    const outcome = {
        code: 1,
        timedOut: false,
        notFound: true,
        cwdMissing: false,
        stopped: true,
        startError: undefined,
        signal: undefined
    };

    test('is still "was not found": the stop does not turn it into a success', () => {
        expect(failure(run, 'no-such-binary', outcome, {}, [], undefined)?.message).toBe(
            'no-such-binary was not found'
        );
    });

    test('a child that really started and was stopped is not a failure', () => {
        expect(
            failure(run, 'sleep', { ...outcome, notFound: false }, {}, [], undefined)
        ).toBeUndefined();
    });
});
