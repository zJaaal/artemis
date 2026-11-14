import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { WINDOWS_PLATFORM } from '../constants.js';
import type { SpawnRequest } from '../models.js';
import { createTempFolders } from '../test/temp.js';
import { spawnChild } from './exec.js';
import { launchOf } from './windows-launch.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';

describe('launchOf: any platform but Windows', () => {
    test('starts the command as given, arguments untouched', () => {
        expect(
            launchOf(
                { command: 'pnpm', args: ['build', 'a b'], cwd: undefined, env: undefined },
                'linux'
            )
        ).toEqual({ command: 'pnpm', args: ['build', 'a b'], verbatim: false });
    });

    test('a .cmd file is not special there', () => {
        expect(
            launchOf({ command: './run.cmd', args: [], cwd: undefined, env: undefined }, 'darwin')
        ).toEqual({ command: './run.cmd', args: [], verbatim: false });
    });
});

describe('launchOf: Windows', () => {
    const env = { ComSpec: COMSPEC };

    test('a .cmd file given by its path goes through cmd.exe with its arguments escaped', () => {
        expect(
            launchOf(
                { command: 'C:\\tools\\run.cmd', args: ['a&b'], cwd: undefined, env },
                WINDOWS_PLATFORM
            )
        ).toEqual({
            command: COMSPEC,
            args: ['/d', '/s', '/c', '"C:\\tools\\run.cmd ^"a^&b^""'],
            verbatim: true
        });
    });

    test('so does a .bat file', () => {
        expect(
            launchOf(
                { command: 'C:\\tools\\run.bat', args: [], cwd: undefined, env },
                WINDOWS_PLATFORM
            ).verbatim
        ).toBe(true);
    });

    test('the shell is the ComSpec of the call, in any case of the name', () => {
        expect(
            launchOf(
                {
                    command: 'C:\\tools\\run.cmd',
                    args: [],
                    cwd: undefined,
                    env: { COMSPEC: 'D:\\cmd.exe' }
                },
                WINDOWS_PLATFORM
            ).command
        ).toBe('D:\\cmd.exe');
    });

    test('without a ComSpec it is cmd.exe', () => {
        expect(
            launchOf(
                { command: 'C:\\tools\\run.cmd', args: [], cwd: undefined, env: {} },
                WINDOWS_PLATFORM
            ).command
        ).toBe('cmd.exe');
    });

    test('an .exe file starts directly, as given', () => {
        expect(
            launchOf(
                { command: 'C:\\tools\\a.exe', args: ['x y'], cwd: undefined, env },
                WINDOWS_PLATFORM
            )
        ).toEqual({ command: 'C:\\tools\\a.exe', args: ['x y'], verbatim: false });
    });

    test('a bare name that is nowhere is left as given: the not-found error stays the existing one', () => {
        expect(
            launchOf(
                {
                    command: 'artemis-no-such-program',
                    args: [],
                    cwd: folders.make('artemis-win-'),
                    env: { PATH: '' }
                },
                WINDOWS_PLATFORM
            )
        ).toEqual({ command: 'artemis-no-such-program', args: [], verbatim: false });
    });
});

const isWindows = process.platform === WINDOWS_PLATFORM;

/** The arguments a program prints back, as JSON, one array: from a script file, and from `node -e`, which has no script word. */
const ARGV_SCRIPT = 'process.stdout.write(JSON.stringify(process.argv.slice(2)))';
const EVAL_ARGV_SCRIPT = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';

/** Every character that means something to cmd.exe, a quote, backslashes and a caret, as one list of arguments. */
const NASTY_ARGUMENTS = [
    'a&b',
    '%PATH%',
    '"q"',
    '^',
    'a|b',
    '(x)',
    '!x!',
    'a<b>c',
    'a b',
    'C:\\dir\\',
    'a\\"b',
    'semi;colon,comma',
    'star*question?',
    "it's",
    '`tick`'
];

/** Runs a program through spawnChild for real and returns what it wrote to stdout. */
const outputOf = async (overrides: Partial<SpawnRequest>): Promise<string> => {
    const pieces: string[] = [];

    const outcome = await spawnChild({
        command: '',
        args: [],
        cwd: undefined,
        env: undefined,
        pipe: true,
        timeoutMs: undefined,
        onData: (chunk, stream) => (stream === 'stdout' ? pieces.push(chunk) : undefined),
        ...overrides
    }).done;

    expect(outcome.startError).toBeUndefined();

    return pieces.join('');
};

/** A folder with a script that prints its arguments and a `.cmd` file that runs it with all of its own. */
const folderWithEcho = (cmdFolder: string = ''): { folder: string; cmd: string } => {
    const folder = folders.make('artemis-win-launch-');
    const target = path.join(folder, cmdFolder);

    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(folder, 'argv.js'), ARGV_SCRIPT);

    const cmd = path.join(target, 'echoargs.cmd');

    fs.writeFileSync(
        cmd,
        `@echo off\r\n"${process.execPath}" "${path.join(folder, 'argv.js')}" %*\r\n`
    );

    return { folder, cmd };
};

describe.skipIf(!isWindows)('ctx.exec on Windows: a .cmd file, for real', () => {
    test('given by its path it receives every argument unchanged', async () => {
        const { cmd } = folderWithEcho();

        expect(JSON.parse(await outputOf({ command: cmd, args: NASTY_ARGUMENTS }))).toEqual(
            NASTY_ARGUMENTS
        );
    });

    test('given by its bare name it is found through PATH and PATHEXT', async () => {
        const { folder } = folderWithEcho();
        const env = { ...process.env, PATH: `${folder};${process.env.PATH ?? ''}` };

        expect(
            JSON.parse(await outputOf({ command: 'echoargs', args: ['a&b', '%PATH%'], env }))
        ).toEqual(['a&b', '%PATH%']);
    });

    test('found in the folder of the call', async () => {
        const { folder } = folderWithEcho();

        expect(
            JSON.parse(await outputOf({ command: 'echoargs', args: ['x'], cwd: folder }))
        ).toEqual(['x']);
    });

    test('a shim called by its name with an extension, from PATH, gets its arguments literally', async () => {
        const { folder } = folderWithEcho(path.join('node_modules', '.bin'));
        const bin = path.join(folder, 'node_modules', '.bin');
        const env = { ...process.env, PATH: `${bin};${process.env.PATH ?? ''}` };

        expect(JSON.parse(await outputOf({ command: 'echoargs.cmd', args: ['a&b'], env }))).toEqual(
            ['a&b']
        );
    });

    test('a shim in node_modules/.bin gets the same arguments back', async () => {
        const { cmd } = folderWithEcho(path.join('node_modules', '.bin'));

        expect(JSON.parse(await outputOf({ command: cmd, args: NASTY_ARGUMENTS }))).toEqual(
            NASTY_ARGUMENTS
        );
    });

    test('a path with a space and parentheses in it still runs', async () => {
        const { folder } = folderWithEcho();
        const spaced = path.join(folder, 'Program Files (x86)');

        fs.mkdirSync(spaced);
        fs.copyFileSync(path.join(folder, 'echoargs.cmd'), path.join(spaced, 'echoargs.cmd'));

        expect(
            JSON.parse(await outputOf({ command: path.join(spaced, 'echoargs.cmd'), args: ['ok'] }))
        ).toEqual(['ok']);
    });

    test('npm, a .cmd on PATH, runs', async () => {
        const output = await outputOf({ command: 'npm', args: ['--version'] });

        expect(output.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    test('an .exe still starts directly: node with an argument that has a space', async () => {
        expect(
            JSON.parse(
                await outputOf({
                    command: process.execPath,
                    args: ['-e', EVAL_ARGV_SCRIPT, 'a b', 'c&d']
                })
            )
        ).toEqual(['a b', 'c&d']);
    });

    test('a command that is nowhere is still not found', async () => {
        const outcome = await spawnChild({
            command: 'artemis-no-such-program',
            args: [],
            cwd: undefined,
            env: undefined,
            pipe: true,
            timeoutMs: undefined,
            onData: () => undefined
        }).done;

        expect(outcome.notFound).toBe(true);
    });
});
