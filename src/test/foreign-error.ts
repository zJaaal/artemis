import { COMMAND_ERROR_TAG, USAGE_ERROR_TAG } from '../constants.js';
import type { ForeignErrorOptions } from './models.js';

/**
 * An error as another copy of Artemis would throw it: it is not an instance of our classes, but it
 * carries the same fields and the same `Symbol.for` tags. This is what a global `art` sees when the
 * project it runs has its own local copy of the package.
 */
export const foreignCommandError = (
    message: string,
    { hint, exitCode = 1, usage, isUsage = false }: ForeignErrorOptions = {}
): Error => {
    const error = Object.assign(new Error(message), { hint, exitCode, usage });

    Object.defineProperty(error, COMMAND_ERROR_TAG, { value: true });

    if (isUsage) {
        Object.defineProperty(error, USAGE_ERROR_TAG, { value: true });
    }

    return error;
};
