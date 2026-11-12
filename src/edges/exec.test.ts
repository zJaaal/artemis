import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import type { ChildStream, SpawnRequest } from '../models.js';
import { createTempFolders } from '../test/temp.js';
import { spawnChild } from './exec.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

type Piece = readonly [stream: ChildStream, chunk: string];

const NOT_AN_EXECUTABLE = 'artemis-no-such-program';
const SHORT_TIMEOUT_MS = 100;
const SILENT_JOB = 'setInterval(() => {}, 1000)';
const GAP_MS = 40;

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

    test('a child that runs past the timeout is killed and reported as timed out', async () => {
        const { outcome } = await runNode(SILENT_JOB, { timeoutMs: SHORT_TIMEOUT_MS });

        expect(outcome).toMatchObject({ timedOut: true });
    });

    test('a child killed by the timeout does not report success', async () => {
        const { outcome } = await runNode(SILENT_JOB, { timeoutMs: SHORT_TIMEOUT_MS });

        expect(outcome.code).not.toBe(0);
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

        expect((await child.done).code).not.toBe(0);
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

    test('sends SIGKILL after the grace period to a child that ignores SIGTERM', async () => {
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

        expect((await child.done).code).not.toBe(0);
    });
});
