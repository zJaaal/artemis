import { isFlagToken } from '../utils/flag-token.js';
import { UsageError } from '../errors/errors.js';
import type { ParseSkillWordsFn, SkillWords } from '../models.js';
import { SKILL_FLAGS, SKILL_USAGE_LINE, SKILL_WORD, SKILL_WRITE_PREFIX } from './constants.js';

const usageError = (message: string, hint: string): UsageError =>
    new UsageError(message, { usage: SKILL_USAGE_LINE, hint });

/** Applies one flag to the words read so far. `--write` returns the flag and how many words it used. */
function applyFlag(read: SkillWords, flag: string): SkillWords | undefined {
    switch (flag) {
        case SKILL_FLAGS.json:
            return { ...read, json: true };
        case SKILL_FLAGS.help:
        case SKILL_FLAGS.helpShort:
            return { ...read, help: true };
        case SKILL_FLAGS.yes:
        case SKILL_FLAGS.yesShort:
            return { ...read, yes: true };
        case SKILL_FLAGS.quiet:
            return { ...read, quiet: true };
        default:
            return flag.startsWith(SKILL_WRITE_PREFIX)
                ? { ...read, write: flag.slice(SKILL_WRITE_PREFIX.length) }
                : undefined;
    }
}

/**
 * Reads the words after `skill`: `--write <path>` (or `--write=<path>`), `--yes`, `--quiet`,
 * `--json` and `--help`. Anything else, an argument or an unknown flag, is a usage error (exit 2),
 * and so are `--dry-run` and `--log`, which a built-in word never takes. Pure.
 */
export const parseSkillWords: ParseSkillWordsFn = (words) => {
    let read: SkillWords = { write: undefined, yes: false, json: false, help: false, quiet: false };

    for (let index = 0; index < words.length; index++) {
        const word = words[index] ?? '';

        if (word === SKILL_FLAGS.write) {
            const value = words[index + 1];

            if (value === undefined || isFlagToken(value)) {
                throw usageError(
                    `${SKILL_FLAGS.write} needs a path`,
                    `Try: ${SKILL_WORD} --write SKILL.md (a path that starts with a dash: ${SKILL_WRITE_PREFIX}<path>)`
                );
            }

            read = { ...read, write: value };
            index++;
            continue;
        }

        const next = applyFlag(read, word);

        if (next === undefined) {
            throw usageError(
                `${SKILL_WORD} takes no arguments, but got "${word}"`,
                `${SKILL_WORD} takes --write, --yes, --quiet, --json and --help.`
            );
        }

        read = next;
    }

    if (read.write === '') {
        throw usageError(
            `${SKILL_FLAGS.write} needs a path`,
            `Try: ${SKILL_WORD} --write SKILL.md`
        );
    }

    return read;
};
