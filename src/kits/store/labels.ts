import { LINE_BREAK, LOCK_FIELD_SEPARATOR, LOCK_LABEL_MAX_LENGTH } from './constants.js';
import type { AssertLockLabelFn, HolderOfFn } from './models.js';

// Pure: the label of a named lock, written after the pid and the token (`<pid> <token> <label>`).
// Document locks never have one and keep exactly `<pid> <token>`, which `0.1` reads. A process that
// knows only the pid at the start of the file, and compares whole contents to release or take over,
// shares a labeled lock safely with a newer one.

/** The label of a named lock: a non-empty string of one line, at most `LOCK_LABEL_MAX_LENGTH` characters. */
export const assertLockLabel: AssertLockLabelFn = (label) => {
    if (typeof label !== 'string' || label === '') {
        throw new TypeError('store.lock: the label must be a non-empty string.');
    }

    if (LINE_BREAK.test(label)) {
        throw new TypeError('store.lock: the label must be one line, with no line break.');
    }

    if (label.length > LOCK_LABEL_MAX_LENGTH) {
        throw new TypeError(
            `store.lock: the label must be at most ${LOCK_LABEL_MAX_LENGTH} characters, but it has ${label.length}.`
        );
    }
};

/** The process a lock file names, and its label when it has one: everything after the second space. */
export const holderOf: HolderOfFn = (content) => {
    const [first = '', , ...rest] = content.split(LOCK_FIELD_SEPARATOR);
    const label = rest.join(LOCK_FIELD_SEPARATOR).trim();

    return { pid: Number.parseInt(first, 10) || undefined, ...(label ? { label } : {}) };
};
