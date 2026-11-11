import { TERMINATOR } from '../constants.js';
import type { BeforeTerminatorFn } from '../models.js';

/** The words before `--`: after it everything is a plain argument, never a flag. */
export const beforeTerminator: BeforeTerminatorFn = (argv) => {
    const end = argv.indexOf(TERMINATOR);

    return argv.slice(0, end === -1 ? argv.length : end);
};
