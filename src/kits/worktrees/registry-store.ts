import path from 'node:path';

import { makeDirectory, readTextIfExists, writeText } from '../../edges/files.js';
import { CommandError } from '../../errors/errors.js';
import { messageOf } from '../../utils/error-message.js';
import { STATE_INDENT_SPACES } from './constants.js';
import type { CreateRegistryStoreFn, WorktreeRecords } from './models.js';

/** The registry file: JSON the app keeps wherever it says. The kit stores nothing of its own. */
export const createRegistryStore: CreateRegistryStoreFn = (stateFile) => ({
    read: () => {
        const text = readTextIfExists(stateFile);

        if (text === undefined) {
            return {};
        }

        try {
            const records: WorktreeRecords = JSON.parse(text);

            return records;
        } catch (error) {
            throw new CommandError(`${stateFile} is not valid JSON: ${messageOf(error)}`, {
                hint: 'Fix the file, or delete it to forget every registered worktree.'
            });
        }
    },
    write: (records) => {
        makeDirectory(path.dirname(stateFile));
        writeText(stateFile, `${JSON.stringify(records, null, STATE_INDENT_SPACES)}\n`);
    }
});
