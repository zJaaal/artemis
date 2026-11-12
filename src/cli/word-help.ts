import { DEFAULT_BIN_NAME } from '../constants.js';
import { describeBuiltins } from '../help/help.js';
import type { WordHelpFn } from '../models.js';
import { successEnvelope } from '../run/report.js';
import { BUILTINS } from './constants.js';

/**
 * What `art <word> --help` prints. Plain, it is the word's usage text. Under `--json` it is the one
 * object every call promises, holding the word's entry of the manifest, the same one
 * `help <word> --json` gives. The help of a word is answered before any project is looked for, so
 * the binary is the shipped `art`.
 */
export const wordHelp: WordHelpFn = ({ id, text, json }) => {
    if (!json) {
        return text;
    }

    const [result] = describeBuiltins(
        DEFAULT_BIN_NAME,
        BUILTINS.filter((builtin) => builtin.id === id)
    );

    return successEnvelope(id, result);
};
