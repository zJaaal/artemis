import { describe, expect, test } from 'vitest';

import { EXEC_TAIL_LINE_CHARS, EXEC_TAIL_LINES } from '../constants.js';
import { createTail, pickExecMode, timeoutText } from './exec.js';

const noFlags = { capture: false, quiet: false, json: false, log: false };

describe('pickExecMode: one test per row of the table', () => {
    test('capture pipes into the output and shows nothing', () => {
        expect(pickExecMode({ ...noFlags, capture: true })).toEqual({
            pipe: true,
            echo: 'none',
            keep: true
        });
    });

    test('--quiet pipes and shows nothing', () => {
        expect(pickExecMode({ ...noFlags, quiet: true })).toEqual({
            pipe: true,
            echo: 'none',
            keep: true
        });
    });

    test('--json pipes and shows everything on stderr, so stdout stays one object', () => {
        expect(pickExecMode({ ...noFlags, json: true })).toEqual({
            pipe: true,
            echo: 'stderr',
            keep: true
        });
    });

    test('text with --log pipes and shows each stream where it came from', () => {
        expect(pickExecMode({ ...noFlags, log: true })).toEqual({
            pipe: true,
            echo: 'split',
            keep: true
        });
    });

    test('text with none of the above inherits the terminal and keeps nothing', () => {
        expect(pickExecMode(noFlags)).toEqual({ pipe: false, echo: 'none', keep: false });
    });
});

describe('pickExecMode: the first row that applies wins', () => {
    test('capture beats --json and --quiet', () => {
        expect(pickExecMode({ capture: true, quiet: true, json: true, log: true }).echo).toBe(
            'none'
        );
    });

    test('--quiet beats --json', () => {
        expect(pickExecMode({ ...noFlags, quiet: true, json: true }).echo).toBe('none');
    });

    test('--json beats --log', () => {
        expect(pickExecMode({ ...noFlags, json: true, log: true }).echo).toBe('stderr');
    });
});

describe('createTail', () => {
    test('keeps whole lines of one stream', () => {
        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'one\ntwo\n');

        expect(tail.lines()).toEqual(['one', 'two']);
    });

    test('joins a line that arrives in two chunks', () => {
        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'hel');
        tail.push('stdout', 'lo\n');

        expect(tail.lines()).toEqual(['hello']);
    });

    test('a half-written line of one stream does not glue onto the other', () => {
        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'out half');
        tail.push('stderr', 'err whole\n');

        expect(tail.lines()).toEqual(['err whole', 'out half']);
    });

    test('closes a last line that has no line break', () => {
        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stderr', 'no break');

        expect(tail.lines()).toEqual(['no break']);
    });

    test('keeps only the last lines', () => {
        const tail = createTail(2, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'a\nb\nc\n');

        expect(tail.lines()).toEqual(['b', 'c']);
    });

    test('cuts a long line', () => {
        const tail = createTail(EXEC_TAIL_LINES, 5);

        tail.push('stdout', 'abcdefghij\n');

        expect(tail.lines()).toEqual(['abcde']);
    });

    test('drops blank lines and carriage returns', () => {
        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'a\r\n\n   \nb\n');

        expect(tail.lines()).toEqual(['a', 'b']);
    });
});

describe('timeoutText', () => {
    test('writes 1500 ms as 1.5 s', () => {
        expect(timeoutText(1500)).toBe('1.5 s');
    });

    test('writes 30000 ms as 30 s, with no trailing zeros', () => {
        expect(timeoutText(30000)).toBe('30 s');
    });
});
