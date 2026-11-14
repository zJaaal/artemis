import path from 'node:path';

import { AUDIT_FILE_NAME, EXIT_CODE } from '../constants.js';
import { discover } from '../discover/discover.js';
import type { CliOptions, HistoryCommandFn, ShippedWord } from '../models.js';
import { findCommand } from '../resolve/resolve.js';
import { printResult } from '../run/report.js';
import { resolveWorld } from '../run/world.js';
import {
    HISTORY_HELP,
    HISTORY_SHADOW_WARNING,
    HISTORY_WORD,
    NOTHING_RECORDED
} from './constants.js';
import { historyLine, parseHistoryWords } from './history.js';
import { readHistory } from './read-history.js';
import { projectOrThrow, resolveSettings, resolveStateDir } from './settings.js';
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

/** `history --help`: the usage text (a tool's names its bin), or under --json the manifest entry. */
export function writeHistoryHelp(host: CliOptions, json: boolean, bin: string | undefined): void {
    const { io } = resolveWorld(host);

    io.stdout.write(`${wordHelp({ id: HISTORY_WORD, text: HISTORY_HELP, json, bin })}\n`);
}

/**
 * `history [command words]... [--limit <n>] [--json] [--quiet]`: the runs the audit trail recorded,
 * newest first. A word of the binary itself, like `state`: it needs a project, but not a commands
 * folder that loads. The caller has read the words (and answered `--help`) and found the project
 * and its settings: from the current folder on the shipped route, from the bin file of a published
 * tool that turned auditing on.
 */
export const historyCommand: HistoryCommandFn = async (parsed, host, { project, settings }) => {
    const { io } = resolveWorld(host);
    const { commandsDir } = settings;

    if (shadowsWord(commandsDir, HISTORY_WORD) && !parsed.quiet) {
        io.stderr.write(`Warning: ${HISTORY_SHADOW_WARNING}\n`);
    }

    const commandId = await commandIdOf(commandsDir, parsed.command);
    const file = path.join(resolveStateDir(project), AUDIT_FILE_NAME);
    const { entries, skipped } = readHistory(file, { command: commandId, limit: parsed.limit });

    printResult(io, {
        json: parsed.json,
        command: HISTORY_WORD,
        text: entries.length ? entries.map(historyLine).join(NEWLINE) : NOTHING_RECORDED,
        result: { entries, skipped }
    });

    return EXIT_CODE.OK;
};

/**
 * `history` on the shipped route: reads the words once, so `--help` and a wrong flag are answered
 * where there is no project too, then finds the project from the current folder and runs the word.
 */
export const shippedHistory: ShippedWord['run'] = (words, host, cwd) => {
    const parsed = parseHistoryWords(words);

    if (parsed.help) {
        writeHistoryHelp(host, parsed.json, undefined);

        return EXIT_CODE.OK;
    }

    const project = projectOrThrow(cwd, 'shipped');

    return historyCommand(parsed, host, { project, settings: resolveSettings(project, 'shipped') });
};
