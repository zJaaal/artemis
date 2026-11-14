import { describe, expect, test } from 'vitest';

import { HISTORY_HELP, HISTORY_USAGE_LINE, HISTORY_WORD } from './constants.js';
import { wordHelp } from './word-help.js';

describe('wordHelp: the text', () => {
    test('without a bin it is the text as it is', () => {
        expect(wordHelp({ id: HISTORY_WORD, text: HISTORY_HELP, json: false })).toBe(HISTORY_HELP);
    });

    test('with a bin it goes right after the leading "Usage: "', () => {
        const text = wordHelp({ id: HISTORY_WORD, text: HISTORY_HELP, json: false, bin: 'mytool' });

        expect(text.startsWith(`Usage: mytool ${HISTORY_USAGE_LINE}`)).toBe(true);
    });

    test('the rest of the text is untouched', () => {
        const text = wordHelp({ id: HISTORY_WORD, text: HISTORY_HELP, json: false, bin: 'mytool' });

        expect(text.replace('mytool ', '')).toBe(HISTORY_HELP);
    });
});

describe('wordHelp: --json', () => {
    test('is the manifest entry of the word, with or without a bin', () => {
        const plain = wordHelp({ id: HISTORY_WORD, text: HISTORY_HELP, json: true });
        const named = wordHelp({ id: HISTORY_WORD, text: HISTORY_HELP, json: true, bin: 'mytool' });

        expect(named).toBe(plain);
    });
});
