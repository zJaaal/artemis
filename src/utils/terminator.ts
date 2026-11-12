import { JSON_FLAG, QUIET_FLAG, TERMINATOR } from '../constants.js';
import type { BeforeTerminatorFn, JsonRequestedFn } from '../models.js';

/** The words before `--`: after it everything is a plain argument, never a flag. */
export const beforeTerminator: BeforeTerminatorFn = (argv) => {
    const end = argv.indexOf(TERMINATOR);

    return argv.slice(0, end === -1 ? argv.length : end);
};

/** Whether the command line asks for `--json`. After `--` it is a plain argument, so it does not count. */
export const jsonRequested: JsonRequestedFn = (argv) => beforeTerminator(argv).includes(JSON_FLAG);

/** Whether the command line asks for `--quiet`. After `--` it is a plain argument, so it does not count. */
export const quietRequested: JsonRequestedFn = (argv) =>
    beforeTerminator(argv).includes(QUIET_FLAG);
