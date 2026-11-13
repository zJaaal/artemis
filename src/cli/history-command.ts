import path from 'node:path';

import { AUDIT_FILE_NAME, EXIT_CODE } from '../constants.js';
import { parseAuditText } from '../audit/audit.js';
import { discover } from '../discover/discover.js';
import { isFolder, readManifest, readTextIfExists } from '../edges/files.js';
import { CommandError } from '../errors/errors.js';
import type { HistoryCommandFn } from '../models.js';
import { findCommand } from '../resolve/resolve.js';
import { printResult } from '../run/report.js';
import { resolveWorld } from '../run/world.js';
import { messageOf } from '../utils/error-message.js';
import {
    HISTORY_HELP,
    HISTORY_SHADOW_WARNING,
    HISTORY_WORD,
    NOTHING_RECORDED
} from './constants.js';
import { historyLine, parseHistoryWords, selectHistory } from './history.js';
import { findProject, noProjectError, resolveSettings, resolveStateDir } from './settings.js';
import { shadowsWord } from './shadow.js';
import { wordHelp } from './word-help.js';
import { NEWLINE } from '../constants.js';

/**
 * The id a person typed, with an alias turned into its command. Commands that cannot be loaded are
 * no reason to refuse: the history is still there, and then only an exact id matches.
 */
async function commandIdOf(
    commandsDir: string,
    words: readonly string[]
): Promise<string | undefined> {
    if (!words.length) {
        return undefined;
    }

    const typed = words.join(' ');

    try {
        return findCommand(await discover(commandsDir), typed)?.id ?? typed;
    } catch {
        // ignoreUnloadableCommands: a broken commands folder must not hide the history of the runs
        return typed;
    }
}

/** The text of the audit trail, or undefined when nothing was recorded yet. */
function readAudit(file: string): string | undefined {
    try {
        return readTextIfExists(file);
    } catch (error) {
        throw new CommandError(`Cannot read the audit trail ${file}: ${messageOf(error)}`, {
            hint: 'Check the permissions of the state folder, or fix "artemis".stateDir in package.json.'
        });
    }
}

/**
 * `history [command words]... [--limit <n>] [--json] [--quiet]`: the runs the audit trail recorded,
 * newest first. Handled by the shipped binary itself, like `state`: it needs a project, but not a
 * commands folder that loads.
 */
export const historyCommand: HistoryCommandFn = async (words, host, cwd) => {
    const parsed = parseHistoryWords(words);
    const { io } = resolveWorld(host);

    if (parsed.help) {
        io.stdout.write(
            `${wordHelp({ id: HISTORY_WORD, text: HISTORY_HELP, json: parsed.json })}\n`
        );

        return EXIT_CODE.OK;
    }

    const project = findProject(cwd, readManifest, isFolder, 'shipped');

    if (!project) {
        throw noProjectError(cwd, 'shipped');
    }

    const { commandsDir } = resolveSettings(project, 'shipped');

    if (shadowsWord(commandsDir, HISTORY_WORD) && !parsed.quiet) {
        io.stderr.write(`Warning: ${HISTORY_SHADOW_WARNING}\n`);
    }

    const text = readAudit(path.join(resolveStateDir(project), AUDIT_FILE_NAME));
    const { entries, skipped } = parseAuditText(text ?? '');
    const commandId = await commandIdOf(commandsDir, parsed.command);
    const shown = selectHistory(entries, { commandId, limit: parsed.limit });

    printResult(io, {
        json: parsed.json,
        command: HISTORY_WORD,
        text: shown.length ? shown.map(historyLine).join(NEWLINE) : NOTHING_RECORDED,
        result: { entries: shown, skipped }
    });

    return EXIT_CODE.OK;
};
