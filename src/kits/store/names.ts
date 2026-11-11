import { DOC_NAME } from './constants.js';
import type { AssertDocNameFn, IsValidDocNameFn } from './models.js';

/** Whether a name can be a document: it becomes a file name, so it stays small and plain. */
export const isValidDocName: IsValidDocNameFn = (name) => DOC_NAME.test(name);

/** A bad name is a bug in the app, not a mistake of the person running it: a TypeError. */
export const assertDocName: AssertDocNameFn = (name) => {
    if (!isValidDocName(name)) {
        throw new TypeError(
            `"${name}" is not a valid document name: use lowercase letters, digits and dashes, e.g. "feature-flags".`
        );
    }
};
