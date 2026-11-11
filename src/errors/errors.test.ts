import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { foreignCommandError } from '../test/foreign-error.js';
import { CommandError, UsageError, isCommandError, isUsageError } from './errors.js';

describe('CommandError', () => {
    test('exits with the failed code by default', () => {
        expect(new CommandError('boom').exitCode).toBe(EXIT_CODE.FAILED);
    });

    test('carries its hint', () => {
        expect(new CommandError('boom', { hint: 'try again' }).hint).toBe('try again');
    });

    test('has no hint unless it is given one', () => {
        expect(new CommandError('boom').hint).toBeUndefined();
    });

    test('keeps the error that caused it', () => {
        const cause = new Error('disk full');

        expect(new CommandError('boom', { cause }).cause).toBe(cause);
    });

    test('is named after its class and is an Error', () => {
        const error = new CommandError('boom');

        expect([error.name, error instanceof Error]).toEqual(['CommandError', true]);
    });
});

describe('UsageError', () => {
    test('exits with the usage code', () => {
        expect(new UsageError('bad line').exitCode).toBe(EXIT_CODE.USAGE);
    });

    test('carries the usage line and the hint', () => {
        expect(new UsageError('bad line', { usage: 'art x <a>', hint: 'add a' })).toMatchObject({
            usage: 'art x <a>',
            hint: 'add a'
        });
    });

    test('is a CommandError, named UsageError', () => {
        const error = new UsageError('bad line');

        expect([error.name, error instanceof CommandError]).toEqual(['UsageError', true]);
    });
});

describe('isCommandError and isUsageError', () => {
    test('a CommandError is an expected failure', () => {
        expect(isCommandError(new CommandError('boom'))).toBe(true);
    });

    test('a UsageError is an expected failure and a usage error', () => {
        const error = new UsageError('bad line');

        expect([isCommandError(error), isUsageError(error)]).toEqual([true, true]);
    });

    test('a CommandError is not a usage error', () => {
        expect(isUsageError(new CommandError('boom'))).toBe(false);
    });

    test('a plain Error is neither: it is a bug', () => {
        const error = new Error('kaput');

        expect([isCommandError(error), isUsageError(error)]).toEqual([false, false]);
    });

    test('something that is not an Error is neither', () => {
        expect([isCommandError('boom'), isUsageError(undefined)]).toEqual([false, false]);
    });

    test('an error thrown by another copy of Artemis is still an expected failure', () => {
        expect(isCommandError(foreignCommandError('boom', { hint: 'fix it' }))).toBe(true);
    });

    test('a usage error thrown by another copy is still a usage error', () => {
        expect(isUsageError(foreignCommandError('bad line', { isUsage: true }))).toBe(true);
    });

    test('an error that only looks like one, without the tag, is not', () => {
        expect(isCommandError(Object.assign(new Error('boom'), { hint: 'x', exitCode: 1 }))).toBe(
            false
        );
    });
});
