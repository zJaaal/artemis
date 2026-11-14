import { COMSPEC_VARIABLE, DEFAULT_COMSPEC, WINDOWS_PLATFORM } from '../constants.js';
import type { LaunchOfFn } from '../models.js';
import {
    cmdArguments,
    envValue,
    isCmdScript,
    windowsCandidates
} from '../utils/windows-command.js';
import { isFile } from './files.js';

// Edge: on Windows `npm`, `pnpm`, `npx` and everything in `node_modules/.bin` are `.cmd` files, which
// Node refuses to start without a shell. They are started through `cmd.exe` with every argument escaped
// so nothing in it is interpreted; everything else starts as it was given, as on every other platform.

/** What `ctx.exec` spawns on Windows: a batch file runs through `cmd.exe`, anything else as given. */
const windowsLaunch: LaunchOfFn = ({ command, args, cwd, env }) => {
    const variables = env ?? process.env;
    const file = windowsCandidates(command, { cwd, env: variables }).find(isFile) ?? command;

    return isCmdScript(file)
        ? {
              command: envValue(variables, COMSPEC_VARIABLE) ?? DEFAULT_COMSPEC,
              args: cmdArguments(file, args),
              verbatim: true
          }
        : { command, args, verbatim: false };
};

/**
 * How to start a command on this platform. Only Windows differs: a bare name is looked up through
 * the folder of the call, PATH and PATHEXT, and a `.cmd` or `.bat` file (found, or given with its
 * extension) goes through `cmd.exe`.
 */
export const launchOf: LaunchOfFn = (request, platform = process.platform) =>
    platform === WINDOWS_PLATFORM
        ? windowsLaunch(request)
        : { command: request.command, args: request.args, verbatim: false };
