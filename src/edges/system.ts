import os from 'node:os';

import type { HomeDirectoryFn } from '../models.js';

// Edge: where the machine says the user's home is.
export const homeDirectory: HomeDirectoryFn = () => os.homedir();
