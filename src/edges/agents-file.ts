import path from 'node:path';

import { AGENTS_FILE } from '../constants.js';
import type { ReadAgentsFn } from '../models.js';
import { readRunningPackage } from './package-info.js';
import { readTextIfExists } from './files.js';

// Edge: the AGENTS.md that ships beside the running copy of Artemis (never the project's).

/** The AGENTS.md of the copy that is running, as it is; undefined when the package is missing it (a broken install). */
export const readAgents: ReadAgentsFn = () => {
    const file = path.join(readRunningPackage().root, AGENTS_FILE);
    const markdown = readTextIfExists(file);

    return markdown === undefined ? undefined : { file, markdown };
};
