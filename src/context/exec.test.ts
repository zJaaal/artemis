import { describe, expect, test } from 'vitest';

import {
    EXEC_ERROR_LINE_BUFFER_CHARS,
    EXEC_TAIL_LINE_CHARS,
    EXEC_TAIL_LINES
} from '../constants.js';
import {
    createErrorLines,
    createLineReader,
    createOutputKeeper,
    pickExecMode,
    timeoutText
} from './exec.js';

const noFlags = { capture: false, quiet: false, json: false, log: false, errorPattern: false };

/** The tail of a child with no `errorPattern`: lines go in, the last ones come out. */
const tailKeeper = (tailLines: number, tailChars: number) => {
    const keeper = createOutputKeeper({
        tailLines,
        tailChars,
        errorPattern: undefined,
        errorLines: 0
    });

    return { push: keeper.push, lines: keeper.tail };
};

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
    const matching = (pattern: RegExp, maxLines: number, maxChars: number, ...lines: string[]) => {
        const found = createErrorLines(pattern, maxLines, maxChars);

        lines.forEach(found.add);

        return found.lines();
    };

    test('keeps the lines that match, in order', () => {
        expect(matching(/error/, 20, 500, 'ok', 'error: one', 'fine', 'error: two')).toEqual([
            'error: one',
            'error: two'
        ]);
    });

    test('keeps only the first maxLines matches', () => {
        expect(matching(/x/, 2, 500, 'x1', 'x2', 'x3')).toEqual(['x1', 'x2']);
    });

    test('cuts each kept line at maxChars, after matching it whole', () => {
        expect(matching(/END$/, 2, 5, `${'x'.repeat(20)}END`)).toEqual(['xxxxx']);
    });

    test('has nothing when nothing matches', () => {
        expect(matching(/x/, 2, 5, 'abc')).toEqual([]);
    });
});

describe('createOutputKeeper', () => {
    const keeperOf = (errorPattern: RegExp | undefined) =>
        createOutputKeeper({
            tailLines: 3,
            tailChars: EXEC_TAIL_LINE_CHARS,
            errorPattern,
            errorLines: 2
        });

    test('keeps the last lines as a tail', () => {
        const keeper = keeperOf(undefined);

        keeper.push('stdout', 'a\nb\nc\nd\n');

        expect(keeper.tail()).toEqual(['b', 'c', 'd']);
    });

    test('has no error lines without a pattern', () => {
        const keeper = keeperOf(undefined);

        keeper.push('stdout', 'error\n');

        expect(keeper.errorLines()).toEqual([]);
    });

    test('keeps a match the tail no longer holds', () => {
        const keeper = keeperOf(/^error/);

        keeper.push('stdout', 'error: early\nb\nc\nd\ne\n');

        expect([keeper.errorLines(), keeper.tail()]).toEqual([['error: early'], ['c', 'd', 'e']]);
    });

    test('matches a long line split across chunks whole, and cuts the tail and the match after', () => {
        const keeper = keeperOf(/^x+END$/);

        keeper.push('stdout', 'x'.repeat(EXEC_TAIL_LINE_CHARS * 4));
        keeper.push('stdout', 'END\n');

        expect([keeper.errorLines()[0]?.length, keeper.tail()[0]?.length]).toEqual([
            EXEC_TAIL_LINE_CHARS,
            EXEC_TAIL_LINE_CHARS
        ]);
    });

    test('a line that never ends is bounded by EXEC_ERROR_LINE_BUFFER_CHARS when there is a pattern', () => {
        const keeper = keeperOf(/END$/);

        keeper.push('stdout', 'x'.repeat(EXEC_ERROR_LINE_BUFFER_CHARS * 2));
        keeper.push('stdout', 'END\n');

        expect(keeper.errorLines()).toEqual([]);
    });

    test('without a pattern a line that never ends is bounded by the tail size', () => {
        const keeper = keeperOf(undefined);

        keeper.push('stdout', 'x'.repeat(EXEC_ERROR_LINE_BUFFER_CHARS));
        keeper.push('stdout', 'END\n');

        expect(keeper.tail()[0]).toHaveLength(EXEC_TAIL_LINE_CHARS);
    });

    test('reads the line still being written when the output ends', () => {
        const keeper = keeperOf(/last/);

        keeper.push('stdout', 'first\nlast words');

        expect(keeper.errorLines()).toEqual(['last words']);
    });

    test('closing the lines for the matches does not lose them from the tail', () => {
        const keeper = keeperOf(/last/);

        keeper.push('stdout', 'first\nlast words');
        keeper.errorLines();

        expect(keeper.tail()).toEqual(['first', 'last words']);
    });
});

describe('the tail does not depend on errorPattern', () => {
    const tailWith = (errorPattern: RegExp | undefined, ...chunks: string[]): string[] => {
        const keeper = createOutputKeeper({
            tailLines: EXEC_TAIL_LINES,
            tailChars: EXEC_TAIL_LINE_CHARS,
            errorPattern,
            errorLines: 2
        });

        chunks.forEach((chunk) => keeper.push('stdout', chunk));

        return keeper.tail();
    };

    const PADDED = [' '.repeat(EXEC_TAIL_LINE_CHARS + 100) + 'x', '\n'];

    test('a line that is blank up to the cut but not as a whole is kept, cut, without a pattern', () => {
        expect(tailWith(undefined, ...PADDED)).toEqual([' '.repeat(EXEC_TAIL_LINE_CHARS)]);
    });

    test('and the same with a pattern', () => {
        expect(tailWith(/never matches/, ...PADDED)).toEqual(tailWith(undefined, ...PADDED));
    });

    test('a line that is blank as a whole is dropped with or without a pattern', () => {
        expect([tailWith(undefined, '   \n'), tailWith(/x/, '   \n')]).toEqual([[], []]);
    });
});

describe('createLineReader', () => {
    const read = (maxChars: number, ...chunks: string[]): string[] => {
        const lines: string[] = [];
        const reader = createLineReader(maxChars, (line) => lines.push(line));

        chunks.forEach((chunk) => reader.push('stdout', chunk));
        reader.flush();

        return lines;
    };

    test('hears every cleaned line', () => {
        expect(read(500, 'one\ntwo\nthree\n')).toEqual(['one', 'two', 'three']);
    });

    test('cuts a line at maxChars', () => {
        expect(read(3, 'abcdef\n')).toEqual(['abc']);
    });

    test('does not hear blank lines', () => {
        expect(read(500, '\n  \nx\n')).toEqual(['x']);
    });

    test('joins a line split across chunks', () => {
        expect(read(500, 'ab', 'cd\n')).toEqual(['abcd']);
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

describe('createOutputKeeper: progress that rewrites its line', () => {
    test('keeps only the last state of a line rewritten with carriage returns', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', '10%\r20%\r30%\n');

        expect(tail.lines()).toEqual(['30%']);
    });

    test('a half-written line never grows past the cut', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, 10);

        Array.from({ length: 1000 }, () => 'progress ').forEach((chunk) =>
            tail.push('stdout', chunk)
        );

        expect(tail.lines()[0]?.length).toBeLessThanOrEqual(10);
    });

    test('the last state of a bar that never ends a line is what the tail shows', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'pulling 10%\rpulling 20%\rpulling 99%');

        expect(tail.lines()).toEqual(['pulling 99%']);
    });

    test('a carriage return that ends a line before its newline arrives is not lost', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'done\r');
        tail.push('stdout', '\n');

        expect(tail.lines()).toEqual(['done']);
    });
});

describe('createOutputKeeper: the tail', () => {
    test('keeps whole lines of one stream', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'one\ntwo\n');

        expect(tail.lines()).toEqual(['one', 'two']);
    });

    test('joins a line that arrives in two chunks', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'hel');
        tail.push('stdout', 'lo\n');

        expect(tail.lines()).toEqual(['hello']);
    });

    test('a half-written line of one stream does not glue onto the other', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'out half');
        tail.push('stderr', 'err whole\n');

        expect(tail.lines()).toEqual(['err whole', 'out half']);
    });

    test('closes a last line that has no line break', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

        tail.push('stderr', 'no break');

        expect(tail.lines()).toEqual(['no break']);
    });

    test('keeps only the last lines', () => {
        const tail = tailKeeper(2, EXEC_TAIL_LINE_CHARS);

        tail.push('stdout', 'a\nb\nc\n');

        expect(tail.lines()).toEqual(['b', 'c']);
    });

    test('cuts a long line', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, 5);

        tail.push('stdout', 'abcdefghij\n');

        expect(tail.lines()).toEqual(['abcde']);
    });

    test('drops blank lines and carriage returns', () => {
        const tail = tailKeeper(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);

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
