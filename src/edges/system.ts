import os from 'node:os';

import type { HomeDirectoryFn, ProcessIdFn, WorkingDirectoryFn } from '../models.js';

// Edge: where the machine says the user's home is.
export const homeDirectory: HomeDirectoryFn = () => os.homedir();

export const workingDirectory: WorkingDirectoryFn = () => process.cwd();

export const processId: ProcessIdFn = () => process.pid;
