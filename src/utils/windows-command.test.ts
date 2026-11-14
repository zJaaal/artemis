import { describe, expect, test } from 'vitest';

import {
    cmdArguments,
    envValue,
    escapeArgument,
    escapeCommand,
    isCmdScript,
    isCmdShim,
    windowsCandidates
} from './windows-command.js';

describe('escapeArgument: every metacharacter of cmd.exe', () => {
    test.each([
        { name: 'an opening parenthesis', character: '(' },
        { name: 'a closing parenthesis', character: ')' },
        { name: 'an opening bracket', character: '[' },
        { name: 'a closing bracket', character: ']' },
        { name: 'a percent sign', character: '%' },
        { name: 'an exclamation mark', character: '!' },
        { name: 'a caret', character: '^' },
        { name: 'a backtick', character: '`' },
        { name: 'a less-than sign', character: '<' },
        { name: 'a greater-than sign', character: '>' },
        { name: 'an ampersand', character: '&' },
        { name: 'a pipe', character: '|' },
        { name: 'a semicolon', character: ';' },
        { name: 'a comma', character: ',' },
        { name: 'an asterisk', character: '*' },
        { name: 'a question mark', character: '?' },
        { name: 'a space', character: ' ' }
    ])('$name is quoted and has a caret before it', ({ character }) => {
        expect(escapeArgument(character, false)).toBe(`^"^${character}^"`);
    });

    test('a double quote is escaped for the program, then the quotes get carets', () => {
        expect(escapeArgument('"', false)).toBe('^"\\^"^"');
    });

    test('an argument with nothing special is only quoted, with carets on the quotes', () => {
        expect(escapeArgument('build', false)).toBe('^"build^"');
    });

    test('an empty argument is an empty pair of quotes', () => {
        expect(escapeArgument('', false)).toBe('^"^"');
    });

    test('a quoted word inside an argument', () => {
        expect(escapeArgument('say "q"', false)).toBe('^"say^ \\^"q\\^"^"');
    });

    test('backslashes before a quote are doubled, and the quote is escaped', () => {
        expect(escapeArgument('a\\"b', false)).toBe('^"a\\\\\\^"b^"');
    });

    test('backslashes at the end are doubled, so they cannot escape the closing quote', () => {
        expect(escapeArgument('C:\\dir\\', false)).toBe('^"C:\\dir\\\\^"');
    });

    test('backslashes in the middle are left alone', () => {
        expect(escapeArgument('C:\\a\\b', false)).toBe('^"C:\\a\\b^"');
    });

    test('a shim escapes twice: every caret, quote and metacharacter gets another caret', () => {
        expect(escapeArgument('&', true)).toBe('^^^"^^^&^^^"');
    });

    test('a shim, an argument with a space', () => {
        expect(escapeArgument('x y', true)).toBe('^^^"x^^^ y^^^"');
    });
});

describe('escapeCommand: the file', () => {
    test('a space gets a caret, and the path is normalized to backslashes', () => {
        expect(escapeCommand('C:/Program Files/nodejs/npm.cmd')).toBe(
            'C:\\Program^ Files\\nodejs\\npm.cmd'
        );
    });

    test('parentheses in a folder name get one too', () => {
        expect(escapeCommand('C:\\Program Files (x86)\\tool\\run.bat')).toBe(
            'C:\\Program^ Files^ ^(x86^)\\tool\\run.bat'
        );
    });

    test('an ampersand in the path cannot start another command', () => {
        expect(escapeCommand('C:\\a&b\\run.cmd')).toBe('C:\\a^&b\\run.cmd');
    });
});

describe('cmdArguments: the line cmd.exe runs', () => {
    test('is /d /s /c and one quoted line: the file, then each argument escaped', () => {
        expect(cmdArguments('C:\\tools\\run.cmd', ['a b', '&'])).toEqual([
            '/d',
            '/s',
            '/c',
            '"C:\\tools\\run.cmd ^"a^ b^" ^"^&^""'
        ]);
    });

    test('without arguments it is the file alone', () => {
        expect(cmdArguments('C:\\tools\\run.cmd', [])).toEqual([
            '/d',
            '/s',
            '/c',
            '"C:\\tools\\run.cmd"'
        ]);
    });

    test('a shim in node_modules/.bin escapes its arguments twice', () => {
        expect(cmdArguments('C:\\app\\node_modules\\.bin\\tsc.cmd', ['x y']).at(-1)).toBe(
            '"C:\\app\\node_modules\\.bin\\tsc.cmd ^^^"x^^^ y^^^""'
        );
    });

    test('a .cmd that is not in node_modules/.bin escapes once', () => {
        expect(cmdArguments('C:\\app\\bin\\tsc.cmd', ['x y']).at(-1)).toBe(
            '"C:\\app\\bin\\tsc.cmd ^"x^ y^""'
        );
    });
});

describe('isCmdScript and isCmdShim', () => {
    test.each(['run.cmd', 'RUN.BAT', 'C:\\x\\npm.Cmd'])('%s is a batch file', (file) => {
        expect(isCmdScript(file)).toBe(true);
    });

    test.each(['node.exe', 'tool.com', 'script.js', 'cmd', 'x.cmd.exe'])('%s is not', (file) => {
        expect(isCmdScript(file)).toBe(false);
    });

    test('a .cmd in node_modules/.bin is a shim, with either slash', () => {
        expect([
            isCmdShim('C:\\app\\node_modules\\.bin\\tsc.cmd'),
            isCmdShim('C:/app/node_modules/.bin/tsc.CMD')
        ]).toEqual([true, true]);
    });

    test('a .cmd elsewhere is not, and a .bat in .bin is not either', () => {
        expect([
            isCmdShim('C:\\Program Files\\nodejs\\npm.cmd'),
            isCmdShim('C:\\app\\node_modules\\.bin\\x.bat')
        ]).toEqual([false, false]);
    });
});

describe('envValue', () => {
    test('finds a name in any case', () => {
        expect(envValue({ Path: 'C:\\x' }, 'PATH')).toBe('C:\\x');
    });

    test('is undefined for a variable that is not there', () => {
        expect(envValue({ HOME: 'x' }, 'PATH')).toBeUndefined();
    });
});

describe('windowsCandidates: where a bare command could be', () => {
    const env = { Path: 'C:\\Tools;"C:\\Program Files\\nodejs"', PATHEXT: '.EXE;.CMD' };

    test('the folder of the call first, then each folder of PATH, each with every extension in order', () => {
        expect(windowsCandidates('npm', { cwd: 'C:\\app', env })).toEqual([
            'C:\\app\\npm.EXE',
            'C:\\app\\npm.CMD',
            'C:\\Tools\\npm.EXE',
            'C:\\Tools\\npm.CMD',
            'C:\\Program Files\\nodejs\\npm.EXE',
            'C:\\Program Files\\nodejs\\npm.CMD'
        ]);
    });

    test('PATHEXT defaults to .COM;.EXE;.BAT;.CMD', () => {
        expect(
            windowsCandidates('x', { cwd: 'C:\\app', env: { PATH: 'C:\\Tools' } }).map((file) =>
                file.slice(file.lastIndexOf('.'))
            )
        ).toEqual(['.COM', '.EXE', '.BAT', '.CMD', '.COM', '.EXE', '.BAT', '.CMD']);
    });

    test('without a cwd it is the folder the process is in', () => {
        expect(windowsCandidates('x', { cwd: undefined, env: { PATHEXT: '.EXE' } })).toEqual([
            'x.EXE'
        ]);
    });

    test('empty entries in PATH are skipped', () => {
        expect(
            windowsCandidates('x', { cwd: 'C:\\a', env: { PATH: ';;C:\\b;', PATHEXT: '.EXE' } })
        ).toEqual(['C:\\a\\x.EXE', 'C:\\b\\x.EXE']);
    });

    test('a command with a path separator is used as given', () => {
        expect(windowsCandidates('bin\\npm', { cwd: 'C:\\app', env })).toEqual([]);
    });

    test('a command with a forward slash too', () => {
        expect(windowsCandidates('./npm', { cwd: 'C:\\app', env })).toEqual([]);
    });

    test('a command with an extension is used as given', () => {
        expect(windowsCandidates('npm.cmd', { cwd: 'C:\\app', env })).toEqual([]);
    });
});
