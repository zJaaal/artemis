import path from 'node:path';

import { PARENT_FOLDER } from '../constants.js';

/**
 * Whether a path is outside a folder: it is the parent, below the parent, or on another root. A name
 * that only starts with two dots (`..state`) is a folder inside it. Pure.
 */
export const pointsOutside = (target: string, folder: string): boolean => {
    const relative = path.relative(folder, target);

    return (
        relative === PARENT_FOLDER ||
        relative.startsWith(`${PARENT_FOLDER}${path.sep}`) ||
        path.isAbsolute(relative)
    );
};
