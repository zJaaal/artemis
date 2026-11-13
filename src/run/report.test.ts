import { describe, expect, test } from 'vitest';

import { EXIT_CODE, GLOBAL_FLAGS_TEXT, USAGE_HINT_GLOBAL } from '../constants.js';
import { CommandError, UsageError } from '../errors/errors.js';
import { foreignCommandError } from '../test/foreign-error.js';
import { createStyle } from '../help/help.js';
import { createSink } from '../test/sink.js';
import { reportError } from './report.js';

/** Pass `null` for a run that never resolved a command. */
const report = (
    error: unknown,
    json: boolean,
    commandId: string | null = 'math add',
    bin?: string
) => {
    const stdout = createSink();
    const stderr = createSink();

    const code = reportError(error, {
        io: { stdout, stderr },
        style: createStyle(false),
        json,
        commandId: commandId ?? undefined,
        bin
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

describe('reportError: the usage hint', () => {
    test('a usage error of a command gets the usage and the global flags as its hint', () => {
        const error = new UsageError('Missing', { usage: 'x <a>', fromCommand: true });

        expect(JSON.parse(report(error, true).out).hint).toBe(
            `x <a>. ${USAGE_HINT_GLOBAL} ${GLOBAL_FLAGS_TEXT}`
        );
    });

    test('a usage error that did not come from a command has no hint', () => {
        expect(
            JSON.parse(report(new UsageError('Missing', { usage: 'x <a>' }), true).out)
        ).not.toHaveProperty('hint');
    });

    test('a usage error with its own hint keeps it', () => {
        const error = new UsageError('Missing', {
            usage: 'x <a>',
            hint: 'Mine',
            fromCommand: true
        });

        expect(JSON.parse(report(error, true).out).hint).toBe('Mine');
    });

    test('a usage error from an older copy, with no marker, gets no hint', () => {
        const error = foreignCommandError('Missing', {
            exitCode: EXIT_CODE.USAGE,
            usage: 'x <a>',
            isUsage: true
        });

        expect(JSON.parse(report(error, true).out)).not.toHaveProperty('hint');
    });
});

describe('reportError as text', () => {
    test('prints the error and its hint on stderr', () => {
        expect(report(new CommandError('Bad input', { hint: 'Fix it' }), false).err).toBe(
            'Error: Bad input\nHint: Fix it\n'
        );
    });

    test('prints the usage line of a usage error as it is when the run has no bin', () => {
        expect(report(new UsageError('Missing', { usage: 'state [<doc>]' }), false).err).toContain(
            'Usage  state [<doc>]'
        );
    });

    test('puts the bin of the run in front of the usage line', () => {
        const { err } = report(new UsageError('Missing', { usage: 'x <a>' }), false, 'x', 'art');

        expect(err).toContain('Usage  art x <a>');
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

describe('reportError with an error from another copy of Artemis', () => {
    test('keeps its hint under --json', () => {
        const { out } = report(foreignCommandError('Bad input', { hint: 'Fix it' }), true);

        expect(JSON.parse(out)).toEqual({
            ok: false,
            command: 'math add',
            error: 'Bad input',
            hint: 'Fix it'
        });
    });

    test('keeps its hint as text, without a stack trace', () => {
        const { err } = report(foreignCommandError('Bad input', { hint: 'Fix it' }), false);

        expect(err).toBe('Error: Bad input\nHint: Fix it\n');
    });

    test('a usage error from the other copy still exits with the usage code and shows its usage', () => {
        const error = foreignCommandError('Missing', {
            exitCode: EXIT_CODE.USAGE,
            usage: 'x <a>',
            isUsage: true
        });

        const { code, err } = report(error, false, 'x', 'art');

        expect(code).toBe(EXIT_CODE.USAGE);
        expect(err).toContain('Usage  art x <a>');
    });

    test('an exit code that is missing falls back to a failure, never to success', () => {
        const error = foreignCommandError('Bad input', { invalidExitCode: undefined });

        expect(report(error, false).code).toBe(EXIT_CODE.FAILED);
    });

    test('an exit code of 0 falls back to a failure: a failed run never exits 0', () => {
        const error = foreignCommandError('Bad input', { invalidExitCode: EXIT_CODE.OK });

        expect(report(error, false).code).toBe(EXIT_CODE.FAILED);
    });

    test.each([{ value: 7 }, { value: '2' }, { value: null }, { value: Number.NaN }])(
        'an exit code of $value falls back to a failure',
        ({ value }) => {
            const error = foreignCommandError('Bad input', { invalidExitCode: value });

            expect(report(error, false).code).toBe(EXIT_CODE.FAILED);
        }
    );
});
