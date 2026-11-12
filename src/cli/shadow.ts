import path from 'node:path';

import { pathExists } from '../edges/files.js';
import type { ShadowKindFn, ShadowsWordFn } from '../models.js';

/** What hides a word of the binary in the commands folder: a command file, a topic folder, or nothing. */
export const shadowKind: ShadowKindFn = (commandsDir, word) => {
    if (pathExists(path.join(commandsDir, `${word}.js`))) {
        return 'file';
    }

    return pathExists(path.join(commandsDir, word)) ? 'folder' : undefined;
};

/** Whether the project already has a command or topic called like one of the binary's own words, which that word would hide. */
export const shadowsWord: ShadowsWordFn = (commandsDir, word) =>
    shadowKind(commandsDir, word) !== undefined;
