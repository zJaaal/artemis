import { GLOBAL_FLAG_TOKENS, TERMINATOR } from '../constants.js';
import { UsageError } from '../errors/errors.js';
import { isValidDocName } from '../kits/store/names.js';
import { findStrayLeading } from '../resolve/resolve.js';
import type {
    AssertLeadingFlagsFn,
    ParseStateWordsFn,
    PlanStateFn,
    StateWords
} from '../models.js';
import { STATE_FLAGS, STATE_USAGE_LINE, STATE_WORD } from './constants.js';

const usageError = (message: string, hint: string): UsageError =>
    new UsageError(message, { usage: STATE_USAGE_LINE, hint });

/** Whether a word is a flag. After `--` nothing is: it is a document name, whatever it looks like. */
const isFlagWord = (word: string, terminated: boolean): boolean =>
    !terminated && word.startsWith('-');

/** Applies one flag to the words read so far; an unknown one is a usage error. */
function applyFlag(words: StateWords, flag: string): StateWords {
    switch (flag) {
        case STATE_FLAGS.json:
            return { ...words, json: true };
        case STATE_FLAGS.help:
        case STATE_FLAGS.helpShort:
            return { ...words, help: true };
        case STATE_FLAGS.yes:
        case STATE_FLAGS.yesShort:
            return { ...words, yes: true };
        case STATE_FLAGS.reset:
            return { ...words, reset: true };
        case STATE_FLAGS.quiet:
            return { ...words, quiet: true };
        default:
            throw usageError(
                `Unknown option "${flag}"`,
                `${STATE_WORD} takes --reset, --yes, --quiet, --json and --help.`
            );
    }
}

/**
 * The flags typed before `state` belong to the run, so only the global ones may be there: `art
 * --json state` is fine, `art --reset state steps` is not (it would read as `state steps --reset`).
 */
export const assertLeadingFlags: AssertLeadingFlagsFn = (leading, word) => {
    const stray = findStrayLeading(leading);

    if (stray !== undefined) {
        throw usageError(
            `"${stray}" cannot come before ${word}`,
            `Only ${GLOBAL_FLAG_TOKENS.join(', ')} may come first. Try: ${word} ${stray}`
        );
    }
};

/**
 * Reads the words after `state`: at most one document, and the flags `--reset`, `--yes`, `--json`
 * and `--help`. Anything else, a second document or `--reset` with no document, is a usage error
 * (exit 2). Pure: the disk is not looked at here.
 */
export const parseStateWords: ParseStateWordsFn = (words) => {
    let terminated = false;

    let read: StateWords = {
        name: undefined,
        reset: false,
        yes: false,
        json: false,
        help: false,
        quiet: false
    };

    for (const word of words) {
        if (!terminated && word === TERMINATOR) {
            terminated = true;
        } else if (isFlagWord(word, terminated)) {
            read = applyFlag(read, word);
        } else if (read.name === undefined) {
            read = { ...read, name: word };
        } else {
            throw usageError(
                `${STATE_WORD} takes one document, but got "${read.name}" and "${word}"`,
                `Try: ${STATE_WORD} ${read.name}`
            );
        }
    }

    if (read.reset && read.name === undefined && !read.help) {
        throw usageError(
            `${STATE_FLAGS.reset} needs a document`,
            `Try: ${STATE_WORD} <doc> --reset`
        );
    }

    return read;
};

/**
 * What a state call does. The name on the command line is untrusted: one that is not a valid
 * document name is reported exactly like an unknown one, before any path could be built from it.
 * A reset asks first, unless `--yes`; with nobody to answer and no `--yes` it cannot ask. `--help`
 * is not planned here: `stateCommand` answers it before it looks for a project, so it works anywhere.
 */
export const planState: PlanStateFn = ({ words, interactive, existing }) => {
    const { name } = words;

    if (name === undefined) {
        return { kind: 'list' };
    }

    if (!isValidDocName(name) || !existing.includes(name)) {
        return { kind: 'unknown', name };
    }

    if (!words.reset) {
        return { kind: 'show', name };
    }

    if (words.yes) {
        return { kind: 'reset', name, ask: false };
    }

    return interactive ? { kind: 'reset', name, ask: true } : { kind: 'cannot-ask', name };
};
