import type { ErrorCodeFn } from '../models.js';

/** The `code` of a Node system error ("ENOENT", "EEXIST", ...), if the error has one. */
export const codeOf: ErrorCodeFn = (error) => {
    if (!(error instanceof Error) || !('code' in error)) {
        return undefined;
    }

    return typeof error.code === 'string' ? error.code : undefined;
};
