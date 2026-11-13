import { SEARCH_MIN_WORD_CHARS, SEARCH_STOP_WORDS, SEARCH_WORD_SPLIT } from '../constants.js';
import type { WordsOfFn } from '../models.js';

const STOP_WORDS: ReadonlySet<string> = new Set(SEARCH_STOP_WORDS);

/**
 * The words of a text, for search and for "did you mean": lowercased, split on anything that is not a
 * letter or a digit, without one-character words and stop words. Pure.
 */
export const wordsOf: WordsOfFn = (text) =>
    text
        .toLowerCase()
        .split(SEARCH_WORD_SPLIT)
        .filter((word) => word.length >= SEARCH_MIN_WORD_CHARS && !STOP_WORDS.has(word));
