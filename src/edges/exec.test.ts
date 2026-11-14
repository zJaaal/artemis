import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { EXEC_DRAIN_MS, FOLDER_PROBLEM, WINDOWS_PLATFORM } from '../constants.js';

import type { ChildStream, SpawnRequest } from '../models.js';
import {
    NO_EXECUTE_BIT,
    NO_EXECUTE_MODE,
    NO_PERMISSION_BITS,
    NO_SIGNALS,
    NO_SYMLINK_LOOPS,
    ROOT_UID,
    UNDIAGNOSED_GRANDCHILD_PIPE,
    UNREADABLE_MODE
} from '../test/constants.js';
import { withMode } from '../test/permissions.js';
import { createTempFolders } from '../test/temp.js';
import { killTree, spawnChild } from './exec.js';

const folders = createTempFolders();

/** A folder that cannot be read is readable to root, so those tests do not apply there. */
const isRoot = process.getuid?.() === ROOT_UID;
const isWindows = process.platform === WINDOWS_PLATFORM;

afterEach(() => folders.cleanUp());

type Piece = readonly [stream: ChildStream, chunk: string];

const NOT_AN_EXECUTABLE = 'artemis-no-such-program';
const SHORT_TIMEOUT_MS = 100;
const SILENT_JOB = 'setInterval(() => {}, 1000)';
const GAP_MS = 40;
const EXIT_DELAY_MS = 30;
const LATE_WRITE_MS = 600;
const GRANDCHILD_LIFETIME_MS = 4000;
const GRANDCHILD_JOB = `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${GRANDCHILD_LIFETIME_MS})'], { stdio: 'inherit' }); process.exit(0)`;

/** Runs `node -e <script> ...args` for real and collects what it printed, in arrival order. */
const runNode = async (
    script: string,
    overrides: Partial<SpawnRequest> = {},
    args: string[] = []
) => {
    const pieces: Piece[] = [];

    const child = spawnChild({
        command: process.execPath,
        args: ['-e', script, ...args],
        cwd: undefined,
        env: undefined,
        pipe: true,
        timeoutMs: undefined,
        onData: (chunk, stream) => pieces.push([stream, chunk]),
        ...overrides
    });

    return { outcome: await child.done, pieces };
};

describe('spawnChild: how a child ends', () => {
    test('a child that exits 0 reports code 0', async () => {
        expect((await runNode('process.exit(0)')).outcome.code).toBe(0);
    });

    test('a child that exits 3 reports code 3', async () => {
        expect((await runNode('process.exit(3)')).outcome.code).toBe(3);
    });

    test('an executable that does not exist is reported as not found', async () => {
        const child = spawnChild({
            command: NOT_AN_EXECUTABLE,
            args: [],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            onData: () => undefined
        });

        expect(await child.done).toMatchObject({ notFound: true });
    });

    test('a folder that does not exist is not reported as a missing program', async () => {
        const { outcome } = await runNode('process.exit(0)', {
            cwd: path.join(folders.make('artemis-exec-'), 'typo')
        });

        expect(outcome).toMatchObject({ notFound: false, cwdProblem: FOLDER_PROBLEM.MISSING });
    });

    test('a cwd that is a file is not-a-folder, not a start error or a thrown exception', async () => {
        const file = path.join(folders.make('artemis-exec-'), 'plain.txt');

        fs.writeFileSync(file, 'x');

        const { outcome } = await runNode('process.exit(0)', { cwd: file });

        expect(outcome).toMatchObject({
            cwdProblem: FOLDER_PROBLEM.NOT_A_FOLDER,
            startError: undefined
        });
    });

    test.skipIf(NO_SYMLINK_LOOPS)(
        "a cwd that is a symlink loop is a start error in Node's own words, not a permission problem",
        async () => {
            const root = folders.make('artemis-exec-');
            const first = path.join(root, 'a');

            fs.symlinkSync(path.join(root, 'b'), first);
            fs.symlinkSync(first, path.join(root, 'b'));

            const { outcome } = await runNode('process.exit(0)', { cwd: first });

            expect(outcome).toMatchObject({
                cwdProblem: undefined,
                startError: expect.stringMatching(/ELOOP/)
            });
        }
    );

    test('a cwd under a file is not-a-folder too', async () => {
        const file = path.join(folders.make('artemis-exec-'), 'plain.txt');

        fs.writeFileSync(file, 'x');

        const { outcome } = await runNode('process.exit(0)', { cwd: path.join(file, 'sub') });

        expect(outcome).toMatchObject({ cwdProblem: FOLDER_PROBLEM.NOT_A_FOLDER });
    });

    test.skipIf(isRoot || NO_PERMISSION_BITS)(
        'a folder under one that cannot be read is no-access, not a raw error',
        async () => {
            const locked = path.join(folders.make('artemis-exec-'), 'locked');

            fs.mkdirSync(path.join(locked, 'sub'), { recursive: true });

            const { outcome } = await withMode(locked, UNREADABLE_MODE, () =>
                runNode('process.exit(0)', { cwd: path.join(locked, 'sub') })
            );

            expect(outcome).toMatchObject({ cwdProblem: FOLDER_PROBLEM.NO_ACCESS });
        }
    );

    test.skipIf(isRoot || NO_PERMISSION_BITS)(
        'a folder this user cannot enter (no execute bit) is no-access',
        async () => {
            const folder = folders.make('artemis-exec-');

            const { outcome } = await withMode(folder, NO_EXECUTE_MODE, () =>
                runNode('process.exit(0)', { cwd: folder })
            );

            expect(outcome).toMatchObject({ cwdProblem: FOLDER_PROBLEM.NO_ACCESS });
        }
    );

    test('an argument with a null byte is a start error, not a thrown exception', async () => {
        const { outcome } = await runNode('process.exit(0)', {}, ['a\0b']);

        expect(outcome.startError).toMatch(/null bytes|ERR_INVALID_ARG_VALUE/);
    });

    test('a child that leaves a grandchild holding its output does not hang the call', async () => {
        const started = Date.now();

        await runNode(GRANDCHILD_JOB);

        expect(Date.now() - started).toBeLessThan(GRANDCHILD_LIFETIME_MS / 2);
    });

    test('a child that exits before its timeout is not a timeout while its output drains', async () => {
        // The timeout counts from the spawn, and starting node takes as long as the machine takes: it is
        // set a little after the exit, which is inside the moment the output drains
        await runNode('process.exit(0)');

        const started = Date.now();

        await runNode('process.exit(0)');

        const timeoutMs = Date.now() - started + EXIT_DELAY_MS + EXEC_DRAIN_MS / 2;

        const slowExit = GRANDCHILD_JOB.replace(
            'process.exit(0)',
            `setTimeout(() => process.exit(0), ${EXIT_DELAY_MS})`
        );

        const { outcome } = await runNode(slowExit, { timeoutMs });

        expect(outcome.timedOut).toBe(false);
    });

    test.skipIf(UNDIAGNOSED_GRANDCHILD_PIPE)(
        'a grandchild keeps its pipe after the drain: its late write does not kill it',
        async () => {
            const marker = path.join(folders.make('artemis-exec-'), 'marker');
            const grandchild = `process.stdout.on('error', () => {}); setTimeout(() => process.stdout.write('late', (error) => require('node:fs').writeFileSync(process.argv[1], error ? 'dead' : 'ok')), ${LATE_WRITE_MS})`;
            const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, process.argv[1]], { stdio: 'inherit' }); process.exit(0)`;

            await runNode(parent, {}, [marker]);
            await new Promise((resolve) => setTimeout(resolve, LATE_WRITE_MS * 2));

            expect(fs.readFileSync(marker, 'utf8')).toBe('ok');
        }
    );

    test.skipIf(NO_EXECUTE_BIT)(
        'a script that is not executable is a start error, not an exit code',
        async () => {
            const script = path.join(folders.make('artemis-exec-'), 'run.sh');

            fs.writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o644 });

            const { outcome } = await runNode('', { command: script, args: [] });

            expect(outcome.startError).toMatch(/EACCES/);
        }
    );

    test('a child that already exited with an error is not reported as stopped', async () => {
        const child = spawnChild({
            command: process.execPath,
            args: ['-e', GRANDCHILD_JOB.replace('process.exit(0)', 'process.exit(2)')],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            onData: () => undefined
        });

        await new Promise((resolve) => setTimeout(resolve, GAP_MS * 2));
        await child.stop();

        expect(await child.done).toMatchObject({ code: 2, stopped: false });
    });

    test('a child that runs past the timeout is killed and reported as timed out', async () => {
        const { outcome } = await runNode(SILENT_JOB, { timeoutMs: SHORT_TIMEOUT_MS });

        expect(outcome).toMatchObject({ timedOut: true });
    });

    test('a child killed by the timeout does not report success', async () => {
        const { outcome } = await runNode(SILENT_JOB, { timeoutMs: SHORT_TIMEOUT_MS });

        expect(outcome.code).not.toBe(0);
    });

    test.skipIf(NO_SIGNALS)('a child killed by the timeout names the signal', async () => {
        const { outcome } = await runNode(SILENT_JOB, { timeoutMs: SHORT_TIMEOUT_MS });

        expect(outcome).toMatchObject({ timedOut: true, signal: 'SIGTERM' });
    });
});

describe('spawnChild: the output of a piped child', () => {
    test('stdout and stderr arrive in the order they were written, each with its stream', async () => {
        const script = `process.stdout.write('one\\n');
setTimeout(() => process.stderr.write('two\\n'), ${GAP_MS});
setTimeout(() => process.stdout.write('three\\n'), ${GAP_MS * 2});`;

        const { pieces } = await runNode(script);

        expect(pieces).toEqual([
            ['stdout', 'one\n'],
            ['stderr', 'two\n'],
            ['stdout', 'three\n']
        ]);
    });

    test('an inherited child reports nothing through onData', async () => {
        const { pieces } = await runNode('process.exit(0)', { pipe: false });

        expect(pieces).toEqual([]);
    });
});

describe('spawnChild: never a shell', () => {
    test('an argument with spaces and $(...) reaches the child as one unchanged string', async () => {
        const argument = '$(touch x) a b';
        const { pieces } = await runNode('process.stdout.write(process.argv[1])', {}, [argument]);

        expect(pieces).toEqual([['stdout', argument]]);
    });

    test('and nothing in it is run: the file the substitution names never appears', async () => {
        const cwd = folders.make('artemis-exec-');

        await runNode('process.exit(0)', { cwd }, ['$(touch x) a b']);

        expect(fs.existsSync(path.join(cwd, 'x'))).toBe(false);
    });

    test('the child starts in the folder it was given', async () => {
        const cwd = folders.make('artemis-exec-');
        const { pieces } = await runNode('process.stdout.write(process.cwd())', { cwd });

        expect(pieces).toEqual([['stdout', cwd]]);
    });

    test('the child sees the environment it was given', async () => {
        const { pieces } = await runNode('process.stdout.write(process.env.ARTEMIS_PROBE)', {
            env: { ...process.env, ARTEMIS_PROBE: 'seen' }
        });

        expect(pieces).toEqual([['stdout', 'seen']]);
    });
});

describe('spawnChild: stop', () => {
    test('ends a child that would run on', async () => {
        const child = spawnChild({
            command: process.execPath,
            args: ['-e', SILENT_JOB],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            onData: () => undefined
        });

        await child.stop();

        expect(await child.done).toMatchObject({ stopped: true });
    });

    test.skipIf(NO_SIGNALS)('names the signal that ended it', async () => {
        const child = spawnChild({
            command: process.execPath,
            args: ['-e', SILENT_JOB],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            onData: () => undefined
        });

        await child.stop();

        expect(await child.done).toMatchObject({ signal: expect.stringMatching(/^SIG/) });
    });

    test('is harmless once the child has already ended', async () => {
        const child = spawnChild({
            command: process.execPath,
            args: ['-e', 'process.exit(0)'],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            onData: () => undefined
        });

        await child.done;

        await expect(child.stop()).resolves.toBeUndefined();
    });

    test.skipIf(NO_SIGNALS)(
        'sends SIGKILL after the grace period to a child that ignores SIGTERM',
        async () => {
            const script = `process.on('SIGTERM', () => {});
process.stdout.write('ready');
${SILENT_JOB}`;

            let markReady: () => void = () => undefined;

            const ready = new Promise<void>((resolve) => {
                markReady = resolve;
            });

            const child = spawnChild({
                command: process.execPath,
                args: ['-e', script],
                cwd: undefined,
                env: undefined,
                pipe: true,
                timeoutMs: undefined,
                killGraceMs: SHORT_TIMEOUT_MS,
                onData: () => markReady()
            });

            await ready;
            await child.stop();

            expect(await child.done).toMatchObject({
                stopped: true,
                signal: expect.stringMatching(/^SIG/)
            });
        }
    );
});

/** Whether a process is still there: signal 0 only asks. */
const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        // ignoreProcessGone: the error of signal 0 is how a process that is gone answers
        return false;
    }
};

const GRANDCHILD_JOB_FOR_TREE = `const grandchild = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write(String(grandchild.pid)); setInterval(() => {}, 1000)`;
const TREE_TIMEOUT_MS = 3000;
const EXIT_SETTLES_MS = 60;
const GONE_POLL_MS = 50;
const GONE_WITHIN_MS = 5000;

describe('killTree', () => {
    test('a child that never started has no pid, and there is nothing to end', async () => {
        await expect(killTree(undefined)).resolves.toBeUndefined();
    });
});

describe.skipIf(!isWindows)('spawnChild: stop on Windows ends the whole tree', () => {
    test('a grandchild the child started is gone after stop', async () => {
        let grandchildPid = '';

        const child = spawnChild({
            command: process.execPath,
            args: ['-e', GRANDCHILD_JOB_FOR_TREE],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            onData: (chunk) => {
                grandchildPid += chunk;
            }
        });

        await vi.waitFor(() => expect(grandchildPid).not.toBe(''));
        expect(isAlive(Number(grandchildPid))).toBe(true);

        await child.stop();

        await vi.waitFor(() => expect(isAlive(Number(grandchildPid))).toBe(false), {
            timeout: GONE_WITHIN_MS,
            interval: GONE_POLL_MS
        });
    });

    test('a child that already exited is not tree-killed: its pid may belong to another process now', async () => {
        const killed: (number | undefined)[] = [];
        let wrote = false;

        const child = spawnChild({
            command: process.execPath,
            args: ['-e', "process.stdout.write('x'); process.exit(0)"],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            killTree: (pid) => {
                killed.push(pid);

                return Promise.resolve();
            },
            onData: () => {
                wrote = true;
            }
        });

        await vi.waitFor(() => expect(wrote).toBe(true));
        // It exits right after writing; its output is still draining for a moment, which is when stop is called
        await new Promise((resolve) => setTimeout(resolve, EXIT_SETTLES_MS));
        await child.stop();

        expect(killed).toEqual([]);
    });

    test('a child that is still running is tree-killed, with its pid', async () => {
        const killed: (number | undefined)[] = [];

        const child = spawnChild({
            command: process.execPath,
            args: ['-e', SILENT_JOB],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            killTree: (pid) => {
                killed.push(pid);

                return Promise.resolve();
            },
            onData: () => undefined
        });

        await child.stop();

        expect(killed).toHaveLength(1);
    });

    test('a timeout ends the tree too', async () => {
        let grandchildPid = '';

        const child = spawnChild({
            command: process.execPath,
            args: ['-e', GRANDCHILD_JOB_FOR_TREE],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: TREE_TIMEOUT_MS,
            onData: (chunk) => {
                grandchildPid += chunk;
            }
        });

        expect(await child.done).toMatchObject({ timedOut: true });
        expect(grandchildPid).not.toBe('');

        await vi.waitFor(() => expect(isAlive(Number(grandchildPid))).toBe(false), {
            timeout: GONE_WITHIN_MS,
            interval: GONE_POLL_MS
        });
    });
});
