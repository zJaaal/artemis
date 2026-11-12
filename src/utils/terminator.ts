import { JSON_FLAG, LOG_FLAG, QUIET_FLAG, TERMINATOR } from '../constants.js';
import type { BeforeTerminatorFn, JsonRequestedFn } from '../models.js';

/** The words before `--`: after it everything is a plain argument, never a flag. */
export const beforeTerminator: BeforeTerminatorFn = (argv) => {
    const end = argv.indexOf(TERMINATOR);

    return argv.slice(0, end === -1 ? argv.length : end);
};

/** The words that can be flags: before `--`, and not the value of `--log` (`--log --json` logs to a file called `--json`). */
const flagWords = (argv: readonly string[]): string[] =>
    beforeTerminator([...argv]).filter((word, index, words) => words[index - 1] !== LOG_FLAG);

/** Whether the command line asks for `--json`. After `--` it is a plain argument, so it does not count. */
export const jsonRequested: JsonRequestedFn = (argv) => flagWords(argv).includes(JSON_FLAG);

/** Whether the command line asks for `--quiet`. After `--` it is a plain argument, so it does not count. */
export const quietRequested: JsonRequestedFn = (argv) => flagWords(argv).includes(QUIET_FLAG);
