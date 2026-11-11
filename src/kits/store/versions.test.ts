import { describe, expect, test } from 'vitest';

import { CommandError } from '../../errors/errors.js';
import { thrownBy } from '../../test/thrown.js';
import { CORRUPT_DOCUMENT_HINT } from './constants.js';
import {
    assertUpgrades,
    invalidVersionMessage,
    unwrapVersion,
    upgradeValue,
    wrapVersion
} from './versions.js';

const FILE = 'data/steps.json';

const addOne = (previous: unknown) => ({ ...(previous as object), one: true });
const addTwo = (previous: unknown) => ({ ...(previous as object), two: true });
const UPGRADES = { 1: addOne, 2: addTwo };

describe('wrapVersion', () => {
    test('version 0 is the plain value', () => {
        expect(wrapVersion({ a: 1 }, 0)).toEqual({ a: 1 });
    });

    test('version 1 and up wraps the value with its version', () => {
        expect(wrapVersion({ a: 1 }, 2)).toEqual({ $version: 2, data: { a: 1 } });
    });
});

describe('unwrapVersion', () => {
    test('a plain value is version 0', () => {
        expect(unwrapVersion({ a: 1 })).toEqual({ version: 0, value: { a: 1 } });
    });

    test('a wrapped value gives its version and its data', () => {
        expect(unwrapVersion({ $version: 2, data: { a: 1 } })).toEqual({
            version: 2,
            value: { a: 1 }
        });
    });

    test('an array is version 0', () => {
        expect(unwrapVersion([1, 2])).toEqual({ version: 0, value: [1, 2] });
    });

    test('null is version 0', () => {
        expect(unwrapVersion(null)).toEqual({ version: 0, value: null });
    });

    test('an object with a $version that is not a number is version 0', () => {
        expect(unwrapVersion({ $version: 'two', data: 1 })).toEqual({
            version: 0,
            value: { $version: 'two', data: 1 }
        });
    });

    test('an object with a $version but no data is version 0', () => {
        expect(unwrapVersion({ $version: 2 })).toEqual({ version: 0, value: { $version: 2 } });
    });

    test('wrapped data can be anything, a falsy value included', () => {
        expect(unwrapVersion({ $version: 1, data: 0 })).toEqual({ version: 1, value: 0 });
    });
});

describe('upgradeValue', () => {
    test('a file already at the version is returned as it is', () => {
        expect(upgradeValue(FILE, { version: 2, value: { a: 1 } }, 2, UPGRADES)).toEqual({ a: 1 });
    });

    test('a version 0 file goes through every step in order', () => {
        const order: number[] = [];

        const upgrades = {
            1: (previous: unknown) => (order.push(1), previous),
            2: (previous: unknown) => (order.push(2), previous)
        };

        upgradeValue(FILE, { version: 0, value: {} }, 2, upgrades);

        expect(order).toEqual([1, 2]);
    });

    test('each step receives what the one before returned', () => {
        expect(upgradeValue(FILE, { version: 0, value: { a: 1 } }, 2, UPGRADES)).toEqual({
            a: 1,
            one: true,
            two: true
        });
    });

    test('only the steps after the file version run', () => {
        expect(upgradeValue(FILE, { version: 1, value: { a: 1 } }, 2, UPGRADES)).toEqual({
            a: 1,
            two: true
        });
    });

    test('a file newer than the code is a CommandError that names the file and both versions', () => {
        const error = thrownBy(() => upgradeValue(FILE, { version: 3, value: {} }, 2, UPGRADES));

        expect(error).toBeInstanceOf(CommandError);

        expect(error).toMatchObject({
            message: `${FILE} is version 3, newer than this code (2).`
        });
    });

    test('the newer-file error says how to get out of it', () => {
        expect(
            thrownBy(() => upgradeValue(FILE, { version: 3, value: {} }, 2, UPGRADES))
        ).toMatchObject({
            hint: 'Update the app, or reset it to start again from the defaults.'
        });
    });
});

describe('upgradeValue: a version that is not a version', () => {
    test.each([
        { name: 'negative', version: -1 },
        { name: 'fractional', version: 0.5 },
        { name: 'infinite', version: Number.POSITIVE_INFINITY },
        { name: 'not a number', version: Number.NaN }
    ])('a $name file version is a CommandError naming the file', ({ version }) => {
        const error = thrownBy(() => upgradeValue(FILE, { version, value: {} }, 2, UPGRADES));

        expect([error instanceof CommandError, String((error as Error).message)]).toEqual([
            true,
            expect.stringContaining(FILE)
        ]);
    });

    test('the error says how to get out of it', () => {
        expect(
            thrownBy(() => upgradeValue(FILE, { version: -1, value: {} }, 2, UPGRADES))
        ).toMatchObject({ hint: CORRUPT_DOCUMENT_HINT });
    });

    test('a negative version is refused before any upgrade runs', () => {
        const upgrades = { 1: addOne, 2: addTwo };
        const ran: string[] = [];

        const spied = { 1: (v: unknown) => (ran.push('1'), upgrades[1](v)), 2: upgrades[2] };

        thrownBy(() => upgradeValue(FILE, { version: -1, value: {} }, 2, spied));

        expect(ran).toEqual([]);
    });
});

describe('invalidVersionMessage', () => {
    test('a whole number is a version', () => {
        expect(invalidVersionMessage(FILE, 3)).toBeUndefined();
    });

    test('0 is a version', () => {
        expect(invalidVersionMessage(FILE, 0)).toBeUndefined();
    });

    test('0.5 is not, and the message names the file', () => {
        expect(invalidVersionMessage(FILE, 0.5)).toContain(FILE);
    });
});

describe('assertUpgrades', () => {
    test('version 0 needs no upgrades', () => {
        expect(thrownBy(() => assertUpgrades('steps', 0, {}))).toBeUndefined();
    });

    test('every step from 1 to the version present is fine', () => {
        expect(thrownBy(() => assertUpgrades('steps', 2, UPGRADES))).toBeUndefined();
    });

    test('a missing step is a TypeError naming the document and the step', () => {
        expect(thrownBy(() => assertUpgrades('steps', 2, { 2: addTwo }))).toMatchObject({
            name: 'TypeError',
            message: expect.stringContaining('upgrades[1]')
        });
    });

    test('a negative version is a TypeError', () => {
        expect(thrownBy(() => assertUpgrades('steps', -1, {}))).toBeInstanceOf(TypeError);
    });

    test('a fractional version is a TypeError', () => {
        expect(thrownBy(() => assertUpgrades('steps', 1.5, UPGRADES))).toBeInstanceOf(TypeError);
    });

    test('a document version that is not a number is a TypeError', () => {
        expect(thrownBy(() => assertUpgrades('steps', Number.NaN, {}))).toBeInstanceOf(TypeError);
    });

    test.each([{ key: 'foo' }, { key: '0' }, { key: '-1' }, { key: '1.5' }])(
        'an upgrade keyed "$key" is a TypeError naming the key',
        ({ key }) => {
            expect(
                thrownBy(() => assertUpgrades('steps', 1, { 1: addOne, [key]: addTwo }))
            ).toMatchObject({ name: 'TypeError', message: expect.stringContaining(`"${key}"`) });
        }
    );
});
