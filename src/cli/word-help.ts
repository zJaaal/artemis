import { describeBuiltins } from '../help/help.js';
import type { WordHelpFn } from '../models.js';
import { successEnvelope } from '../run/report.js';
import { BUILTINS, USAGE_PREFIX } from './constants.js';

/**
 * What `art <word> --help` prints. Plain, it is the word's usage text. Under `--json` it is the one
 * object every call promises, holding the word's entry of the manifest, the same one
 * `help <word> --json` gives. On the shipped route the help of a word is answered before any project
 * is looked for, so the text names no binary; a tool's `history` passes its `bin`, which goes after the
 * leading `Usage: `.
 */
export const wordHelp: WordHelpFn = ({ id, text, json, bin }) => {
    if (!json) {
        return bin === undefined ? text : text.replace(USAGE_PREFIX, `${USAGE_PREFIX}${bin} `);
    }

    const [result] = describeBuiltins(BUILTINS.filter((builtin) => builtin.id === id));

    return successEnvelope(id, result);
};
