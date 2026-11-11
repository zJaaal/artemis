import {
    EDGE_DASHES,
    INVALID_NAME_RUN,
    MAX_INSTANCE_NAME_LENGTH,
    VALID_NAME
} from './constants.js';
import type { IsValidNameFn, ToWorktreeNameFn } from './models.js';

/** "Core_Feat X" -> "core-feat-x": a folder name turned into a valid instance name. */
export const toWorktreeName: ToWorktreeNameFn = (folder) =>
    folder
        .toLowerCase()
        .replace(INVALID_NAME_RUN, '-')
        .replace(EDGE_DASHES, '')
        .slice(0, MAX_INSTANCE_NAME_LENGTH);

/** Lowercase letters, digits and dashes, starting with a letter or digit, within the length limit. */
export const isValidName: IsValidNameFn = (name) => VALID_NAME.test(name);
