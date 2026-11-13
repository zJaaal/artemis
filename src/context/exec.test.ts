import { describe, expect, test } from 'vitest';

import { EXEC_TAIL_LINE_CHARS, EXEC_TAIL_LINES } from '../constants.js';
import { createErrorLines, createTail, pickExecMode, timeoutText } from './exec.js';

const noFlags = { capture: false, quiet: false, json: false, log: false, errorPattern: false };

describe('pickExecMode: an errorPattern', () => {
    test('makes a child that would inherit the terminal piped and shown stream by stream', () => {
        expect(pickExecMode({ ...noFlags, errorPattern: true })).toEqual({
            pipe: true,
            echo: 'split',
            keep: true
        });
    });

    test('does not change what --quiet shows', () => {
        expect(pickExecMode({ ...noFlags, quiet: true, errorPattern: true })).toEqual(
            pickExecMode({ ...noFlags, quiet: true })
        );
    });

    test('does not change what --json shows', () => {
        expect(pickExecMode({ ...noFlags, json: true, errorPattern: true })).toEqual(
            pickExecMode({ ...noFlags, json: true })
        );
    });
});

describe('createErrorLines', () => {
    test('keeps the lines that match, in order', () => {
        const found = createErrorLines(/error/, 20, 500);

        ['ok', 'error: one', 'fine', 'error: two'].forEach(found.add);

        expect(found.lines()).toEqual(['error: one', 'error: two']);
    });

    test('keeps only the first maxLines matches', () => {
        const found = createErrorLines(/x/, 2, 500);

        ['x1', 'x2', 'x3'].forEach(found.add);

        expect(found.lines()).toEqual(['x1', 'x2']);
    });

    test('cuts each line at maxChars', () => {
        const found = createErrorLines(/x/, 2, 5);

        found.add('xxxxxxxxxx');

        expect(found.lines()).toEqual(['xxxxx']);
    });

    test('has nothing when nothing matches', () => {
        const found = createErrorLines(/x/, 2, 5);

        found.add('abc');

        expect(found.lines()).toEqual([]);
    });
});

describe('createTail: the line listener', () => {
    test('hears every cleaned line, also the ones the tail no longer keeps', () => {
        const heard: string[] = [];
        const tail = createTail(1, 500, (line) => heard.push(line));

        tail.push('stdout', 'one\ntwo\nthree\n');

        expect(heard).toEqual(['one', 'two', 'three']);
    });

    test('hears a line before it is cut', () => {
        const heard: string[] = [];
        const tail = createTail(5, 3, (line) => heard.push(line));

        tail.push('stdout', 'abcdef\n');

        expect(heard).toEqual(['abcdef']);
    });

    test('does not hear blank lines', () => {
        const heard: string[] = [];
        const tail = createTail(5, 500, (line) => heard.push(line));

        tail.push('stdout', '\n  \nx\n');

        expect(heard).toEqual(['x']);
    });
});

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
        expect(
            pickExecMode({ ...noFlags, capture: true, quiet: true, json: true, log: true }).echo
        ).toBe('none');
    });

    test('--quiet beats --json', () => {
        expect(pickExecMode({ ...noFlags, quiet: true, json: true }).echo).toBe('none');
    });

    test('--json beats --log', () => {
        expect(pickExecMode({ ...noFlags, json: true, log: true }).echo).toBe('stderr');
    });
});

describe('createTail: progress that rewrites its line', () => {
    test('keeps only the last state of a line rewritten with carriage returns', () => {
        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', '10%\r20%\r30%\n');

        expect(tail.lines()).toEqual(['30%']);
    });

    test('a half-written line never grows past the cut', () => {
        const tail = createTail(EXEC_TAIL_LINES, 10);

        Array.from({ length: 1000 }, () => 'progress ').forEach((chunk) =>
            tail.push('stdout', chunk)
        );

        expect(tail.lines()[0]?.length).toBeLessThanOrEqual(10);
    });

    test('the last state of a bar that never ends a line is what the tail shows', () => {
        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'pulling 10%\rpulling 20%\rpulling 99%');

        expect(tail.lines()).toEqual(['pulling 99%']);
    });

    test('a carriage return that ends a line before its newline arrives is not lost', () => {
        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'done\r');
        tail.push('stdout', '\n');

        expect(tail.lines()).toEqual(['done']);
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
