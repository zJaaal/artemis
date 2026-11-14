import path from 'node:path';

import {
    BARE_COMMAND_PATTERN,
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
    DOUBLE_QUOTE,
    PATHEXT_VARIABLE,
    PATH_VARIABLE,
    WINDOWS_LIST_SEPARATOR
} from '../constants.js';
import type { CmdArgumentsFn, EnvValueFn, WindowsCandidatesFn } from '../models.js';

// Pure: how to hand a batch file and its arguments to `cmd.exe` so that nothing in them is interpreted,
// and where a bare command could be on Windows. The rules are those of `cross-spawn`.

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
    const quoted = `${DOUBLE_QUOTE}${argument
        .replace(CMD_QUOTE_BACKSLASHES, CMD_ESCAPED_QUOTE)
        .replace(CMD_TRAILING_BACKSLASHES, CMD_DOUBLED_BACKSLASHES)}${DOUBLE_QUOTE}`;

    const once = quoted.replace(CMD_META_CHARACTERS, CMD_CARET);

    return twice ? once.replace(CMD_META_CHARACTERS, CMD_CARET) : once;
}

/** What to give `cmd.exe` to run a batch file: `/d /s /c "<file> <args>"`, with `windowsVerbatimArguments`. */
export const cmdArguments: CmdArgumentsFn = (file, args) => {
    const twice = isCmdShim(file);
    const line = [escapeCommand(file), ...args.map((argument) => escapeArgument(argument, twice))];

    return [...CMD_SWITCHES, `${DOUBLE_QUOTE}${line.join(' ')}${DOUBLE_QUOTE}`];
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
        .map((entry) => entry.trim().replaceAll(DOUBLE_QUOTE, ''))
        .filter((entry) => entry !== '');

/**
 * Every file a bare command (no path separator) could be on Windows, in the order it is looked for:
 * the folder of the call, then each folder of PATH. A name without an extension gets each extension
 * of PATHEXT; a name with one (`eslint.cmd`) is looked for as it is. A command with a path is used as
 * given, so it has none.
 */
export const windowsCandidates: WindowsCandidatesFn = (command, { cwd, env }) => {
    if (!BARE_COMMAND_PATTERN.test(command)) {
        return [];
    }

    const folders = [cwd ?? '.', ...splitList(envValue(env, PATH_VARIABLE) ?? '')];

    if (path.win32.extname(command) !== '') {
        return folders.map((folder) => path.win32.join(folder, command));
    }

    const extensions = splitList(envValue(env, PATHEXT_VARIABLE) ?? DEFAULT_PATHEXT);

    return folders.flatMap((folder) =>
        extensions.map((extension) => path.win32.join(folder, `${command}${extension}`))
    );
};
