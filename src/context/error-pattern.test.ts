import { describe, expect, test } from 'vitest';

import {
    EXEC_ERROR_LINES,
    EXEC_TAIL_LINE_CHARS,
    EXEC_TAIL_LINES,
    EXIT_CODE
} from '../constants.js';
import { art, envelope } from '../test/art.js';

const TOTAL_LINES = 2000;
const ERROR_AT = 1800;

// The children set process.exitCode instead of calling process.exit after printing: on Linux a
// child's pipe is a socket, and process.exit drops whatever it has not written yet.

/** A child that prints `total` lines, `error: ...` at the given ones, and exits with `code`. */
const noisy = (errorAt: number[], code: number, total = TOTAL_LINES): string =>
    `const at = new Set(${JSON.stringify(errorAt)}); for (let i = 1; i <= ${total}; i++) console.log(at.has(i) ? 'error: line ' + i : 'line ' + i); process.exitCode = ${code}`;

const failure = (out: string) =>
    envelope({ code: 0, out, err: '' }) as unknown as {
        ok: boolean;
        error: string;
        tail?: string[];
        errorLines?: string[];
        hint?: string;
    };

describe('ctx.exec errorPattern: a failed child', () => {
    test('keeps a match at line 1,800 of 2,000, where the 40-line tail cannot reach', async () => {
        const run = await art(['exec', noisy([ERROR_AT], 1), '--pattern', '^error', '--json']);

        expect(failure(run.out).errorLines).toEqual([`error: line ${ERROR_AT}`]);
    });

    test('the tail is still the last lines, which do not hold the match', async () => {
        const run = await art(['exec', noisy([ERROR_AT], 1), '--pattern', '^error', '--json']);

        expect(failure(run.out).tail).toHaveLength(EXEC_TAIL_LINES);
        expect(failure(run.out).tail).not.toContain(`error: line ${ERROR_AT}`);
    });

    test('keeps only the first EXEC_ERROR_LINES matches', async () => {
        const many = Array.from({ length: 50 }, (_, index) => index + 1);
        const run = await art(['exec', noisy(many, 1, 100), '--pattern', '^error', '--json']);

        expect(failure(run.out).errorLines).toEqual(
            many.slice(0, EXEC_ERROR_LINES).map((line) => `error: line ${line}`)
        );
    });

    test('cuts each kept line at EXEC_TAIL_LINE_CHARS', async () => {
        const script = `console.log('error: ' + 'x'.repeat(${EXEC_TAIL_LINE_CHARS * 2})); process.exitCode = 1`;
        const run = await art(['exec', script, '--pattern', '^error', '--json']);

        expect(failure(run.out).errorLines?.[0]).toHaveLength(EXEC_TAIL_LINE_CHARS);
    });

    test('goes out right after the tail in the envelope', async () => {
        const run = await art(['exec', noisy([ERROR_AT], 1), '--pattern', '^error', '--json']);

        expect(Object.keys(failure(run.out))).toEqual([
            'ok',
            'command',
            'error',
            'hint',
            'tail',
            'errorLines'
        ]);
    });

    test('reads stderr as well', async () => {
        const script = "console.error('error: on stderr'); process.exitCode = 1";
        const run = await art(['exec', script, '--pattern', '^error', '--json']);

        expect(failure(run.out).errorLines).toEqual(['error: on stderr']);
    });

    test('is absent when nothing matches', async () => {
        const run = await art(['exec', noisy([], 1, 100), '--pattern', '^error', '--json']);

        expect(failure(run.out)).not.toHaveProperty('errorLines');
    });

    test('is absent from a call without errorPattern', async () => {
        const run = await art(['exec', noisy([ERROR_AT], 1), '--json']);

        expect(failure(run.out)).not.toHaveProperty('errorLines');
    });

    test('is also kept on a timeout', async () => {
        const script = "console.log('error: slow'); setInterval(() => {}, 1000)";

        const run = await art([
            'exec',
            script,
            '--pattern',
            '^error',
            '--timeout',
            '300',
            '--json'
        ]);

        expect(failure(run.out).errorLines).toEqual(['error: slow']);
    });
});

describe('ctx.exec errorPattern: a timeout that exits 0', () => {
    // The child catches SIGTERM and exits 0: Artemis still stopped it for taking too long
    const POLITE =
        "process.on('SIGTERM', () => process.exit(0)); console.log('error: slow'); setInterval(() => {}, 1000)";

    test('keeps the matching lines, though the exit code is 0', async () => {
        const run = await art([
            'exec',
            POLITE,
            '--pattern',
            '^error',
            '--timeout',
            '300',
            '--json'
        ]);

        expect(failure(run.out)).toMatchObject({
            ok: false,
            error: expect.stringMatching(/took longer than/),
            errorLines: ['error: slow']
        });
    });
});

describe('ctx.exec errorPattern: a long line that arrives in pieces', () => {
    const LONG = EXEC_TAIL_LINE_CHARS * 4;
    const PIECES = `process.stdout.write('x'.repeat(${LONG})); setTimeout(() => { process.stdout.write('FATAL\\n'); process.exitCode = 1 }, 150)`;

    test('is matched whole, and only the kept line is cut', async () => {
        const run = await art(['exec', PIECES, '--pattern', `^x{${LONG}}FATAL$`, '--json']);

        expect(failure(run.out).errorLines).toEqual(['x'.repeat(EXEC_TAIL_LINE_CHARS)]);
    });
});

describe('ctx.exec errorPattern: what does not fail', () => {
    test('a successful child has no errorLines, even when lines match', async () => {
        const run = await art(['exec', noisy([5], 0, 10), '--pattern', '^error', '--json']);

        expect(envelope(run).result).toEqual({ code: 0, output: '', skipped: false });
    });

    test('with reject: false a non-zero exit returns the matching lines', async () => {
        const run = await art([
            'exec',
            noisy([3], 2, 10),
            '--pattern',
            '^error',
            '--no-reject',
            '--json'
        ]);

        expect(envelope(run).result).toEqual({
            code: 2,
            output: '',
            skipped: false,
            errorLines: ['error: line 3']
        });
    });

    test('with reject: false and nothing matching the key is left out', async () => {
        const run = await art([
            'exec',
            noisy([], 2, 10),
            '--pattern',
            '^error',
            '--no-reject',
            '--json'
        ]);

        expect(envelope(run).result).not.toHaveProperty('errorLines');
    });
});

describe('ctx.exec errorPattern: text mode', () => {
    test('prints the Error lines under the error when the output was hidden, before the tail', async () => {
        const run = await art(['exec', noisy([ERROR_AT], 1), '--pattern', '^error', '--quiet']);
        const lines = run.err.split('\n');

        expect(lines.indexOf('Error lines')).toBeGreaterThan(-1);
        expect(lines.indexOf('Error lines')).toBeLessThan(lines.indexOf('line 2000') - 1);
        expect(run.err).toContain(`error: line ${ERROR_AT}`);
    });

    test('prints nothing of them when the child showed its output itself', async () => {
        const run = await art(['exec', noisy([5], 1, 10), '--pattern', '^error']);

        expect(run.err).not.toContain('Error lines');
    });

    test('a terminal-mode child is still shown, stream by stream', async () => {
        const script = "console.log('to stdout'); console.error('to stderr'); process.exitCode = 0";
        const run = await art(['exec', script, '--pattern', '^error']);

        expect([run.out, run.err]).toEqual(['to stdout\n', 'to stderr\n']);
    });
});

describe('ctx.exec errorPattern: a pattern that remembers', () => {
    test.each(['g', 'y'])('the %s flag is rejected with a TypeError', async (flag) => {
        const run = await art([
            'exec',
            'process.exit(0)',
            '--pattern',
            'x',
            '--pattern-flags',
            flag,
            '--json'
        ]);

        expect(run.code).toBe(EXIT_CODE.FAILED);
        expect(failure(run.out).error).toMatch(/errorPattern cannot have the g or y flag/);
    });

    test('the i flag is fine', async () => {
        const run = await art([
            'exec',
            'process.exit(0)',
            '--pattern',
            'x',
            '--pattern-flags',
            'i',
            '--json'
        ]);

        expect(run.code).toBe(EXIT_CODE.OK);
    });
});
