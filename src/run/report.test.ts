import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { CommandError, UsageError } from '../errors/errors.js';
import { createStyle } from '../help/help.js';
import { createSink } from '../test/sink.js';
import { reportError } from './report.js';

/** Pass `null` for a run that never resolved a command. */
const report = (error: unknown, json: boolean, commandId: string | null = 'math add') => {
    const stdout = createSink();
    const stderr = createSink();

    const code = reportError(error, {
        io: { stdout, stderr },
        style: createStyle(false),
        json,
        commandId: commandId ?? undefined
    });

    return { code, out: stdout.text, err: stderr.text };
};

describe('reportError under --json', () => {
    test('prints one object on stdout with the message and the hint', () => {
        const { out } = report(new CommandError('Bad input', { hint: 'Try: math add 1 2' }), true);

        expect(JSON.parse(out)).toEqual({
            ok: false,
            command: 'math add',
            error: 'Bad input',
            hint: 'Try: math add 1 2'
        });
    });

    test('leaves the hint out when there is none', () => {
        expect(JSON.parse(report(new CommandError('Bad input'), true).out)).toEqual({
            ok: false,
            command: 'math add',
            error: 'Bad input'
        });
    });

    test('names no command when none was resolved', () => {
        expect(JSON.parse(report(new UsageError('Unknown'), true, null).out)).toMatchObject({
            command: null
        });
    });

    test('writes nothing to stderr', () => {
        expect(report(new CommandError('Bad input'), true).err).toBe('');
    });
});

describe('reportError as text', () => {
    test('prints the error and its hint on stderr', () => {
        expect(report(new CommandError('Bad input', { hint: 'Fix it' }), false).err).toBe(
            'Error: Bad input\nHint: Fix it\n'
        );
    });

    test('prints the usage line of a usage error', () => {
        expect(report(new UsageError('Missing', { usage: 'art x <a>' }), false).err).toContain(
            'Usage  art x <a>'
        );
    });

    test('a plain error is a bug, so its stack is shown', () => {
        expect(report(new Error('kaput'), false).err).toMatch(
            /Error: kaput\n\nError: kaput\n\s+at /
        );
    });

    test('an expected error shows no stack', () => {
        expect(report(new CommandError('Bad input'), false).err).not.toMatch(/\s+at /);
    });

    test('writes nothing to stdout', () => {
        expect(report(new CommandError('Bad input'), false).out).toBe('');
    });
});

describe('reportError exit codes', () => {
    test('a command error exits with its own code', () => {
        expect(report(new CommandError('x'), false).code).toBe(EXIT_CODE.FAILED);
    });

    test('a usage error exits with the usage code', () => {
        expect(report(new UsageError('x'), false).code).toBe(EXIT_CODE.USAGE);
    });

    test('anything else exits as a failure', () => {
        expect(report('a thrown string', false).code).toBe(EXIT_CODE.FAILED);
    });

    test('a thrown value that is not an error is reported as text', () => {
        expect(report('a thrown string', false).err).toBe('Error: a thrown string\n');
    });
});
