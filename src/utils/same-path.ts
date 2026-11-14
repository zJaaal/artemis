import path from 'node:path';

import { WINDOWS_PLATFORM } from '../constants.js';
import type { SamePathFn } from '../models.js';

/**
 * Whether two paths are one folder. They are real paths already (`realPathOrResolve`), so the one
 * thing left is case: Windows paths ignore it, every other platform's do not. Pure: the platform
 * comes in as a parameter.
 */
export const samePath: SamePathFn = (a, b, platform) =>
    platform === WINDOWS_PLATFORM
        ? path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase()
        : a === b;
