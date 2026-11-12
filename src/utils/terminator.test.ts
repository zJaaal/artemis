import { describe, expect, test } from 'vitest';

import { beforeTerminator, jsonRequested, quietRequested } from './terminator.js';

describe('beforeTerminator', () => {
    test('keeps only the words before --', () => {
        expect(beforeTerminator(['echo', '--json', '--', '--json'])).toEqual(['echo', '--json']);
    });

    test('keeps everything when there is no --', () => {
        expect(beforeTerminator(['echo', 'hi'])).toEqual(['echo', 'hi']);
    });

    test('is empty when the line starts with --', () => {
        expect(beforeTerminator(['--', 'a'])).toEqual([]);
    });
});

describe('jsonRequested', () => {
    test('is true when --json is among the arguments', () => {
        expect(jsonRequested(['math', 'add', '--json'])).toBe(true);
    });

    test('is true when --json comes before the command', () => {
        expect(jsonRequested(['--json', 'math'])).toBe(true);
    });

    test('is false when there is no --json', () => {
        expect(jsonRequested(['math', 'add'])).toBe(false);
    });

    test('is false when --json only appears after --, where it is a plain argument', () => {
        expect(jsonRequested(['echo', '--', '--json'])).toBe(false);
    });

    test('is false when --json is the value of --log', () => {
        expect(jsonRequested(['hello', '--log', '--json'])).toBe(false);
    });

    test('is true when --json follows the value of --log', () => {
        expect(jsonRequested(['hello', '--log', 'a.log', '--json'])).toBe(true);
    });
});

describe('quietRequested', () => {
    test('is false when --quiet is the value of --log', () => {
        expect(quietRequested(['hello', '--log', '--quiet'])).toBe(false);
    });

    test('is true when --quiet is among the arguments', () => {
        expect(quietRequested(['hello', '--quiet'])).toBe(true);
    });
});
