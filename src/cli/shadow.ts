import path from 'node:path';

import { pathExists } from '../edges/files.js';
import type { ShadowsWordFn } from '../models.js';

/** Whether the project already has a command or topic called like one of the binary's own words, which that word would hide. */
export const shadowsWord: ShadowsWordFn = (commandsDir, word) =>
    [`${word}.js`, word].some((name) => pathExists(path.join(commandsDir, name)));
