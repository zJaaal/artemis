import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { CommandError, UsageError } from './errors.js';

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
