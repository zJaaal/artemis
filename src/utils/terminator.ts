import { JSON_FLAG, QUIET_FLAG, TERMINATOR } from '../constants.js';
import type { BeforeTerminatorFn, JsonRequestedFn } from '../models.js';

/** The words before `--`: after it everything is a plain argument, never a flag. */
export const beforeTerminator: BeforeTerminatorFn = (argv) => {
    const end = argv.indexOf(TERMINATOR);

    return argv.slice(0, end === -1 ? argv.length : end);
};

/**
 * Whether the command line asks for `--json`. After `--` it is a plain argument, so it does not count.
 * `--log --json` still counts: the parser refuses a value that starts with a dash, so it is a usage
 * error, and it has to come out as the one object the caller asked for (`--log=--json` is the way
 * to log to a file of that name, and is one word).
 */
export const jsonRequested: JsonRequestedFn = (argv) => beforeTerminator(argv).includes(JSON_FLAG);

/** Whether the command line asks for `--quiet`. After `--` it is a plain argument, so it does not count. */
export const quietRequested: JsonRequestedFn = (argv) =>
    beforeTerminator(argv).includes(QUIET_FLAG);
