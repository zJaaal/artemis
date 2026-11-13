import fs from 'node:fs';
import path from 'node:path';

import { AUDIT_MAX_BYTES, AUDIT_ROTATED_FILE_NAME, ERROR_CODE, NEWLINE } from '../constants.js';
import type { AppendAuditFn } from '../models.js';
import { codeOf } from '../utils/error-code.js';

// Edge: the audit trail. One line is appended per run; past `AUDIT_MAX_BYTES` the file is renamed
// to its one old copy first. Rotation is best effort: runs at the same moment may both try it.

/** The size of a file, or 0 when it is not there. */
function sizeOf(file: string): number {
    return fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
}

/** Moves a full file aside. A file that is gone, or taken by another run, is not an error. */
function rotate(file: string): void {
    try {
        fs.renameSync(file, path.join(path.dirname(file), AUDIT_ROTATED_FILE_NAME));
    } catch (error) {
        if (codeOf(error) !== ERROR_CODE.MISSING) {
            throw error;
        }
    }
}

/** Appends one line (its folders created), after moving a file that passed the limit aside. */
export const appendAuditLine: AppendAuditFn = (file, line) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });

    if (sizeOf(file) > AUDIT_MAX_BYTES) {
        rotate(file);
    }

    fs.appendFileSync(file, `${line}${NEWLINE}`);
};
