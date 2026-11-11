import { COMMAND_ERROR_TAG, EXIT_CODE, USAGE_ERROR_TAG } from '../constants.js';
import type { ForeignErrorOptions } from './models.js';

/**
 * An error as another copy of Artemis would throw it: it is not an instance of our classes, but it
 * carries the same fields and the same `Symbol.for` tags. This is what a global `art` sees when the
 * project it runs has its own local copy of the package.
 */
export const foreignCommandError = (message: string, options: ForeignErrorOptions = {}): Error => {
    const { hint, exitCode = EXIT_CODE.FAILED, usage, isUsage = false } = options;

    const error = Object.assign(new Error(message), {
        hint,
        exitCode: 'invalidExitCode' in options ? options.invalidExitCode : exitCode,
        usage
    });

    Object.defineProperty(error, COMMAND_ERROR_TAG, { value: true });

    if (isUsage) {
        Object.defineProperty(error, USAGE_ERROR_TAG, { value: true });
    }

    return error;
};
