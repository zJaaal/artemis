import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { UsageError } from '../errors/errors.js';
import { thrownBy } from '../test/thrown.js';
import { parseStateWords, planState } from './state.js';
import type { StateWords } from '../models.js';

const NO_WORDS: StateWords = {
    name: undefined,
    reset: false,
    yes: false,
    json: false,
    help: false
};

describe('parseStateWords', () => {
    test('no words asks for the list', () => {
        expect(parseStateWords([])).toEqual(NO_WORDS);
    });

    test('a document name is the document', () => {
        expect(parseStateWords(['steps'])).toEqual({ ...NO_WORDS, name: 'steps' });
    });

    test('--reset after a document resets it', () => {
        expect(parseStateWords(['steps', '--reset'])).toEqual({
            ...NO_WORDS,
            name: 'steps',
            reset: true
        });
    });

    test('flags can come before the document', () => {
        expect(parseStateWords(['--reset', 'steps'])).toEqual({
            ...NO_WORDS,
            name: 'steps',
            reset: true
        });
    });

    test.each([
        { word: '--json', field: 'json' },
        { word: '--yes', field: 'yes' },
        { word: '-y', field: 'yes' },
        { word: '--help', field: 'help' },
        { word: '-h', field: 'help' }
    ])('$word sets $field', ({ word, field }) => {
        expect(parseStateWords([word])).toEqual({ ...NO_WORDS, [field]: true });
    });

    test('after -- everything is a document name, even a flag', () => {
        expect(parseStateWords(['--', '--reset'])).toEqual({ ...NO_WORDS, name: '--reset' });
    });

    test('-- itself is not a document', () => {
        expect(parseStateWords(['--'])).toEqual(NO_WORDS);
    });

    test('--reset with --help and no document is just help', () => {
        expect(parseStateWords(['--reset', '--help'])).toEqual({
            ...NO_WORDS,
            reset: true,
            help: true
        });
    });
});

describe('parseStateWords: a wrong command line', () => {
    test('a second document is a usage error naming both', () => {
        expect(thrownBy(() => parseStateWords(['steps', 'flags']))).toMatchObject({
            message: 'state takes one document, but got "steps" and "flags"'
        });
    });

    test('a second document exits 2', () => {
        expect(thrownBy(() => parseStateWords(['steps', 'flags']))).toMatchObject({
            exitCode: EXIT_CODE.USAGE
        });
    });

    test('an unknown flag is a usage error naming it', () => {
        expect(thrownBy(() => parseStateWords(['--set']))).toMatchObject({
            message: 'Unknown option "--set"'
        });
    });

    test('an unknown flag is a UsageError', () => {
        expect(thrownBy(() => parseStateWords(['--set']))).toBeInstanceOf(UsageError);
    });

    test('--reset without a document is a usage error', () => {
        expect(thrownBy(() => parseStateWords(['--reset']))).toMatchObject({
            message: '--reset needs a document',
            exitCode: EXIT_CODE.USAGE
        });
    });

    test('the usage line is part of the error', () => {
        expect(thrownBy(() => parseStateWords(['--set']))).toMatchObject({
            usage: expect.stringContaining('state [<doc>]')
        });
    });
});

const EXISTING = ['instances', 'steps'];

const plan = (words: Partial<StateWords>, interactive = true, existing = EXISTING) =>
    planState({ words: { ...NO_WORDS, ...words }, interactive, existing });

describe('planState', () => {
    test('no document lists', () => {
        expect(plan({})).toEqual({ kind: 'list' });
    });

    test('a document that exists is shown', () => {
        expect(plan({ name: 'steps' })).toEqual({ kind: 'show', name: 'steps' });
    });

    test('a document that does not exist is unknown', () => {
        expect(plan({ name: 'ghost' })).toEqual({ kind: 'unknown', name: 'ghost' });
    });

    test('a reset of an unknown document is unknown, not asked about', () => {
        expect(plan({ name: 'ghost', reset: true, yes: true })).toEqual({
            kind: 'unknown',
            name: 'ghost'
        });
    });

    test.each([
        { name: '..' },
        { name: '../steps' },
        { name: 'a/b' },
        { name: 'Steps' },
        { name: '' },
        { name: 'steps.json' }
    ])('the name "$name" is unknown even if something by that name exists', ({ name }) => {
        expect(plan({ name }, true, [...EXISTING, name])).toEqual({ kind: 'unknown', name });
    });

    test('--reset --yes resets without asking', () => {
        expect(plan({ name: 'steps', reset: true, yes: true })).toEqual({
            kind: 'reset',
            name: 'steps',
            ask: false
        });
    });

    test('--reset --yes resets without asking even when nobody could answer', () => {
        expect(plan({ name: 'steps', reset: true, yes: true }, false)).toEqual({
            kind: 'reset',
            name: 'steps',
            ask: false
        });
    });

    test('--reset asks when someone can answer', () => {
        expect(plan({ name: 'steps', reset: true })).toEqual({
            kind: 'reset',
            name: 'steps',
            ask: true
        });
    });

    test('--reset with nobody to answer and no --yes cannot ask', () => {
        expect(plan({ name: 'steps', reset: true }, false)).toEqual({
            kind: 'cannot-ask',
            name: 'steps'
        });
    });
});
