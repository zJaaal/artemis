import { describe, expect, test } from 'vitest';

import { UsageError } from './errors.js';
import type { ParseTarget } from './models.js';
import { parse } from './parse.js';
import { thrownBy } from './test/thrown.js';

const USAGE_LINE = 'art demo [name] [flags]';

const noFlags: ParseTarget['flags'] = {};

const greet: ParseTarget = {
    args: [{ name: 'name', description: 'Who to greet', default: 'world' }],
    flags: { shout: { type: 'boolean', short: 's' } }
};

const add: ParseTarget = {
    args: [
        { name: 'a', required: true },
        { name: 'b', required: true }
    ],
    flags: noFlags
};

const pick: ParseTarget = {
    args: [{ name: 'color', choices: ['red', 'blue'], default: 'red' }],
    flags: {
        tag: { type: 'string', multiple: true },
        size: { type: 'string', choices: ['small', 'large'] }
    }
};

const parseIt = (target: ParseTarget, argv: string[]) => parse(target, argv, USAGE_LINE);

describe('parse: args', () => {
    test('positional args map in order', () => {
        expect(parseIt(greet, ['ana']).args).toEqual({ name: 'ana' });
    });

    test('an omitted positional falls back to its default', () => {
        expect(parseIt(greet, []).args).toEqual({ name: 'world' });
    });

    test('a missing required arg is a usage error', () => {
        expect(() => parseIt(add, ['1'])).toThrow(/Missing required argument "b"/);
    });

    test('a usage error carries the usage line', () => {
        expect(thrownBy(() => parseIt(add, ['1']))).toMatchObject({ usage: USAGE_LINE });
    });

    test('a value outside the allowed choices is a usage error that lists them', () => {
        expect(() => parseIt(pick, ['green'])).toThrow(
            'Invalid argument "color": "green". Allowed: red, blue'
        );
    });

    test('extra positionals are a usage error', () => {
        expect(() => parseIt(greet, ['a', 'b'])).toThrow('Unexpected argument "b"');
    });

    test('a failed parse is a UsageError', () => {
        expect(thrownBy(() => parseIt(add, []))).toBeInstanceOf(UsageError);
    });
});

describe('parse: flags', () => {
    test('boolean flags with a short form are parsed', () => {
        expect(parseIt(greet, ['ana', '-s']).flags).toEqual({ shout: true });
    });

    test('a flag that was not passed is undefined', () => {
        expect(parseIt(greet, ['ana']).flags).toEqual({ shout: undefined });
    });

    test('repeatable string flags collect every value', () => {
        expect(parseIt(pick, ['blue', '--tag', 'a', '--tag', 'b']).flags).toMatchObject({
            tag: ['a', 'b']
        });
    });

    test('a flag value outside its choices is a usage error that lists them', () => {
        expect(() => parseIt(pick, ['--size', 'huge'])).toThrow(
            'Invalid value for flag "--size": "huge". Allowed: small, large'
        );
    });

    test('unknown flags are a usage error', () => {
        expect(() => parseIt(greet, ['--nope'])).toThrow(/--nope/);
    });

    test('the reason of an unknown flag is its first sentence only', () => {
        expect(thrownBy(() => parseIt(greet, ['--nope']))).toMatchObject({
            message: expect.not.stringContaining('. ')
        });
    });
});

describe('parse: global flags', () => {
    test('--json and --yes are read, with -y as the short form', () => {
        expect(parseIt(greet, ['--json', '-y']).global).toEqual({
            help: false,
            json: true,
            yes: true
        });
    });

    test('--help skips validation, so help works with required args missing', () => {
        expect(parseIt(add, ['--help']).global.help).toBe(true);
    });
});
