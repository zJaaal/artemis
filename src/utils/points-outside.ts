import path from 'node:path';

import { PARENT_FOLDER } from '../constants.js';

/**
 * The path of a folder relative to another, or undefined when it is outside it: the parent, below
 * the parent, or on another root. A name that only starts with two dots (`..state`) is a folder
 * inside it. Pure.
 */
export const relativeInside = (target: string, folder: string): string | undefined => {
    const relative = path.relative(folder, target);

    const isOutside =
        relative === PARENT_FOLDER ||
        relative.startsWith(`${PARENT_FOLDER}${path.sep}`) ||
        path.isAbsolute(relative);

    return isOutside ? undefined : relative;
};

/** Whether a path is outside a folder (see `relativeInside`). */
export const pointsOutside = (target: string, folder: string): boolean =>
    relativeInside(target, folder) === undefined;
