import { parseAuditText } from '../audit/audit.js';
import { readTextIfExists } from '../edges/files.js';
import { CommandError } from '../errors/errors.js';
import type { ReadHistoryFn } from '../models.js';
import { messageOf } from '../utils/error-message.js';
import { HISTORY_DEFAULT_LIMIT } from './constants.js';
import { selectHistory } from './history.js';

/** The text of the audit trail, or undefined when nothing was recorded yet. */
function readAuditText(file: string): string | undefined {
    try {
        return readTextIfExists(file);
    } catch (error) {
        throw new CommandError(`Cannot read the audit trail ${file}: ${messageOf(error)}`, {
            hint: 'Check the permissions of the state folder, or fix "artemis".stateDir in package.json.'
        });
    }
}

/**
 * The recorded runs of an audit file, newest first, those of one command id when given, at most
 * `limit` (default `HISTORY_DEFAULT_LIMIT`): what `art history --json` prints as `entries` and
 * `skipped`. A missing file has no runs. It is what a `run()` caller builds its own `history` on.
 *
 * @throws {TypeError} when `limit` is not a whole number above 0.
 * @throws {CommandError} when the file exists and cannot be read.
 */
export const readHistory: ReadHistoryFn = (auditFile, options = {}) => {
    const { command, limit = HISTORY_DEFAULT_LIMIT } = options;

    if (!Number.isInteger(limit) || limit < 1) {
        throw new TypeError(
            `readHistory: limit must be a whole number above 0, but got ${String(limit)}`
        );
    }

    const { entries, skipped } = parseAuditText(readAuditText(auditFile) ?? '');

    return { entries: selectHistory(entries, { commandId: command, limit }), skipped };
};
