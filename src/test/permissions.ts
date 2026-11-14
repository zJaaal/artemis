import fs from 'node:fs';

import { OWNER_MODE } from './constants.js';

/**
 * Runs `work` while a folder has `mode`, and gives the folder its owner mode back whatever happens,
 * so the temporary folder can be removed even when the test fails.
 */
export const withMode = async <T>(
    folder: string,
    mode: number,
    work: () => Promise<T> | T
): Promise<T> => {
    fs.chmodSync(folder, mode);

    try {
        return await work();
    } finally {
        fs.chmodSync(folder, OWNER_MODE);
    }
};
