import path from 'node:path';

import {
    CMD_CARET,
    CMD_DOUBLED_BACKSLASHES,
    CMD_ESCAPED_QUOTE,
    CMD_META_CHARACTERS,
    CMD_QUOTE_BACKSLASHES,
    CMD_SCRIPT_PATTERN,
    CMD_SHIM_PATTERN,
    CMD_SWITCHES,
    CMD_TRAILING_BACKSLASHES,
    DEFAULT_PATHEXT,
    PATHEXT_VARIABLE,
    PATH_VARIABLE,
    WINDOWS_LIST_SEPARATOR
} from '../constants.js';
import type { CmdArgumentsFn, EnvValueFn, WindowsCandidatesFn } from '../models.js';

// Pure: how to hand a batch file and its arguments to `cmd.exe` so that nothing in them is interpreted,
// and where a bare command could be on Windows. The rules are those of `cross-spawn`.

const QUOTE = '"';
const BARE_COMMAND = /^[^\\/]+$/;

/** Whether a file is a batch file, which only `cmd.exe` can start. */
export const isCmdScript = (file: string): boolean => CMD_SCRIPT_PATTERN.test(file);

/** Whether a file is an npm shim in `node_modules/.bin`, which passes its arguments on to a second `cmd.exe`. */
export const isCmdShim = (file: string): boolean => CMD_SHIM_PATTERN.test(file);

/** A file path as `cmd.exe` reads it: every metacharacter gets a `^` before it. */
export const escapeCommand = (file: string): string =>
    path.win32.normalize(file).replace(CMD_META_CHARACTERS, CMD_CARET);

/**
 * An argument as `cmd.exe` hands it to the program, unchanged: quoted for the program (backslashes
 * before a quote and at the end doubled, the quote escaped), then every metacharacter of `cmd.exe`
 * escaped with `^`, and again when the file is a shim, which runs a second `cmd.exe` over it.
 */
export function escapeArgument(argument: string, twice: boolean): string {
    const quoted = `${QUOTE}${argument
        .replace(CMD_QUOTE_BACKSLASHES, CMD_ESCAPED_QUOTE)
        .replace(CMD_TRAILING_BACKSLASHES, CMD_DOUBLED_BACKSLASHES)}${QUOTE}`;

    const once = quoted.replace(CMD_META_CHARACTERS, CMD_CARET);

    return twice ? once.replace(CMD_META_CHARACTERS, CMD_CARET) : once;
}

/** What to give `cmd.exe` to run a batch file: `/d /s /c "<file> <args>"`, with `windowsVerbatimArguments`. */
export const cmdArguments: CmdArgumentsFn = (file, args) => {
    const twice = isCmdShim(file);
    const line = [escapeCommand(file), ...args.map((argument) => escapeArgument(argument, twice))];

    return [...CMD_SWITCHES, `${QUOTE}${line.join(' ')}${QUOTE}`];
};

/** The value of an environment variable by name, in any case: `Path` and `PATH` are one variable on Windows. */
export const envValue: EnvValueFn = (env, name) => {
    const key = Object.keys(env).find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase()
    );

    return key === undefined ? undefined : env[key];
};

const splitList = (list: string): string[] =>
    list
        .split(WINDOWS_LIST_SEPARATOR)
        .map((entry) => entry.trim().replaceAll(QUOTE, ''))
        .filter((entry) => entry !== '');

/**
 * Every file a bare command (no path separator, no extension) could be on Windows, in the order it
 * is looked for: the folder of the call, then each folder of PATH, each with every extension of
 * PATHEXT. A command with a path or an extension has none: it is used as given.
 */
export const windowsCandidates: WindowsCandidatesFn = (command, { cwd, env }) => {
    if (!BARE_COMMAND.test(command) || path.win32.extname(command) !== '') {
        return [];
    }

    const folders = [cwd ?? '.', ...splitList(envValue(env, PATH_VARIABLE) ?? '')];
    const extensions = splitList(envValue(env, PATHEXT_VARIABLE) ?? DEFAULT_PATHEXT);

    return folders.flatMap((folder) =>
        extensions.map((extension) => path.win32.join(folder, `${command}${extension}`))
    );
};
