import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TempFolders } from './models.js';

/**
 * Temporary folders for one test file. Call `cleanUp` from `afterEach`; every folder made since
 * the last call is removed, whatever the test did inside it.
 */
export const createTempFolders = (): TempFolders => {
    const made: string[] = [];

    return {
        make: (prefix) => {
            const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

            made.push(folder);

            return folder;
        },
        cleanUp: () => {
            made.splice(0).forEach((folder) => fs.rmSync(folder, { recursive: true, force: true }));
        }
    };
};
