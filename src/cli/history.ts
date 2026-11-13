import { ID_SEPARATOR, TERMINATOR } from '../constants.js';
import { UsageError } from '../errors/errors.js';
import type {
    HistoryLineFn,
    HistoryWords,
    ParseHistoryWordsFn,
    SelectHistoryFn
} from '../models.js';
import { isFlagToken } from '../utils/flag-token.js';
import {
    HISTORY_DEFAULT_LIMIT,
    HISTORY_DRY_RUN_TEXT,
    HISTORY_FLAGS,
    HISTORY_LIMIT_HINT,
    HISTORY_LIMIT_PREFIX,
    HISTORY_USAGE_LINE,
    HISTORY_WORD
} from './constants.js';

// Pure: the words after `history`, which runs to show, and how a run reads as a line of text.

const POSITIVE_INTEGER = /^[1-9]\d*$/;

const usageError = (message: string, hint: string): UsageError =>
    new UsageError(message, { usage: HISTORY_USAGE_LINE, hint });

/** The value of `--limit`: a whole number of runs, 1 or more. */
function limitOf(value: string | undefined): number {
    if (value === undefined || !POSITIVE_INTEGER.test(value)) {
        throw usageError(
            `${HISTORY_FLAGS.limit} needs a whole number, 1 or more${value === undefined ? '' : `, but got "${value}"`}`,
            HISTORY_LIMIT_HINT
        );
    }

    return Number(value);
}

/** Applies one flag that stands alone; an unknown one (`--dry-run`, `--log` too) is a usage error. */
function applyFlag(read: HistoryWords, flag: string): HistoryWords {
    switch (flag) {
        case HISTORY_FLAGS.json:
            return { ...read, json: true };
        case HISTORY_FLAGS.help:
        case HISTORY_FLAGS.helpShort:
            return { ...read, help: true };
        case HISTORY_FLAGS.quiet:
            return { ...read, quiet: true };
        default:
            throw usageError(
                `Unknown option "${flag}"`,
                `${HISTORY_WORD} takes --limit, --quiet, --json and --help.`
            );
    }
}

/**
 * Reads the words after `history`: the words of a command id (every word, and every word after `--`),
 * `--limit <n>` or `--limit=<n>`, `--quiet`, `--json` and `--help`. Anything else is a usage error
 * (exit 2), `--dry-run` and `--log` included, which a built-in word never takes.
 */
export const parseHistoryWords: ParseHistoryWordsFn = (words) => {
    let read: HistoryWords = {
        command: [],
        limit: HISTORY_DEFAULT_LIMIT,
        json: false,
        help: false,
        quiet: false
    };

    let terminated = false;

    for (let index = 0; index < words.length; index++) {
        const word = words[index] ?? '';

        if (!terminated && word === TERMINATOR) {
            terminated = true;
        } else if (terminated || !isFlagToken(word)) {
            read = { ...read, command: [...read.command, word] };
        } else if (word === HISTORY_FLAGS.limit) {
            const value = words[index + 1];

            read = {
                ...read,
                limit: limitOf(value !== undefined && isFlagToken(value) ? undefined : value)
            };

            index++;
        } else if (word.startsWith(HISTORY_LIMIT_PREFIX)) {
            read = { ...read, limit: limitOf(word.slice(HISTORY_LIMIT_PREFIX.length)) };
        } else {
            read = applyFlag(read, word);
        }
    }

    return read;
};

/** The newest runs first, those of one command id when given, at most `limit`. */
export const selectHistory: SelectHistoryFn = (entries, { commandId, limit }) =>
    entries
        .filter((entry) => commandId === undefined || entry.command === commandId)
        .reverse()
        .slice(0, limit);

/** One run as text: the time as written (UTC), the command, `dry run` or the exit code, and the arguments. */
export const historyLine: HistoryLineFn = (entry) =>
    [
        entry.time,
        entry.command,
        entry.dryRun ? HISTORY_DRY_RUN_TEXT : `exit ${entry.exitCode}`,
        Array.isArray(entry.argv) ? entry.argv.join(ID_SEPARATOR) : ''
    ]
        .join('  ')
        .trimEnd();
