import {
    GLOBAL_FLAG_TOKENS,
    ID_SEPARATOR,
    SEARCH_FLAG,
    SEARCH_FLAG_PREFIX,
    SEARCH_ID_BONUS,
    SEARCH_MAX_MATCHES,
    SEARCH_MIN_WORD_CHARS,
    SEARCH_PREFIX_MIN,
    SEARCH_STOP_WORD_SET,
    SEARCH_WORD_SPLIT
} from '../constants.js';
import { isFlagToken } from '../utils/flag-token.js';
import { beforeTerminator } from '../utils/terminator.js';
import { isWithin, topicPrefixes } from '../utils/topics.js';
import type {
    ManifestCommand,
    ReadSearchFn,
    SearchCommandsFn,
    WordIndex,
    WordsOfFn
} from '../models.js';

// Pure: the words of a text, the `--search` flag of a command line, and the scoring of commands.

/**
 * The words of a text, for search and for "did you mean": lowercased, split on anything that is not a
 * letter or a digit, without one-character words and stop words.
 */
export const wordsOf: WordsOfFn = (text) =>
    text
        .toLowerCase()
        .split(SEARCH_WORD_SPLIT)
        .filter((word) => word.length >= SEARCH_MIN_WORD_CHARS && !SEARCH_STOP_WORD_SET.has(word));

/** What `--search` took from the words after `help`, and the words that are left (a topic, if any). */
export const readSearch: ReadSearchFn = (tokens) => {
    const flagged = beforeTerminator(tokens);

    const at = flagged.findIndex(
        (token) => token === SEARCH_FLAG || token.startsWith(SEARCH_FLAG_PREFIX)
    );

    if (at === -1) {
        return {
            present: false,
            query: undefined,
            words: tokens.filter((token) => !isFlagToken(token))
        };
    }

    // `--search --json` keeps `--json` as the flag it is: the search then has no value (spec 03's `--log --json`)
    const next = flagged[at + 1];
    const attached = flagged[at]?.startsWith(SEARCH_FLAG_PREFIX) ?? false;
    const takesNext = !attached && next !== undefined && !GLOBAL_FLAG_TOKENS.includes(next);

    const query = attached
        ? flagged[at]?.slice(SEARCH_FLAG_PREFIX.length)
        : takesNext
          ? next
          : undefined;

    const consumed = takesNext ? at + 1 : -1;

    return {
        present: true,
        query,
        words: tokens.filter((token, index) => index !== consumed && !isFlagToken(token))
    };
};

/** The prefixes of a word that are long enough to match by prefix, shorter than the word itself. */
const prefixesOf = (word: string): string[] =>
    Array.from({ length: Math.max(0, word.length - SEARCH_PREFIX_MIN) }, (_, index) =>
        word.slice(0, SEARCH_PREFIX_MIN + index)
    );

const addTo = (map: Map<string, Set<number>>, key: string, id: number): void => {
    const ids = map.get(key) ?? new Set<number>();

    map.set(key, ids.add(id));
};

/** Every word of every command with the id of its command, in one flat list: one pass indexes it. */
const wordsWithIds = (textsOfCommands: readonly string[][]): [word: string, id: number][] =>
    textsOfCommands.flatMap((words, id) => words.map((word): [string, number] => [word, id]));

/** Indexes the words of each text by the word and by its long-enough prefixes, once, so a lookup is a Map read. */
function indexWords(textsOfCommands: readonly string[][]): WordIndex {
    const whole = new Map<string, Set<number>>();
    const prefixed = new Map<string, Set<number>>();

    wordsWithIds(textsOfCommands).forEach(([word, id]) => {
        addTo(whole, word, id);
        prefixesOf(word).forEach((prefix) => addTo(prefixed, prefix, id));
    });

    return { whole, prefixed };
}

const idsOf = (map: ReadonlyMap<string, ReadonlySet<number>>, key: string): number[] => [
    ...(map.get(key) ?? [])
];

/** The commands with a word equal to the query word, or that it is a long-enough prefix of, or that is a prefix of it. */
function lookup(index: WordIndex, word: string): Set<number> {
    return new Set([
        ...idsOf(index.whole, word),
        ...idsOf(index.prefixed, word),
        ...prefixesOf(word).flatMap((prefix) => idsOf(index.whole, prefix))
    ]);
}

const textOf = (command: ManifestCommand, topicDescriptions: ReadonlyMap<string, string>): string =>
    [
        command.id,
        ...(command.aliases ?? []),
        command.description,
        ...(command.examples ?? []),
        ...command.args.flatMap((arg) => [arg.name, arg.description]),
        ...command.flags.flatMap((flag) => [flag.name, flag.description]),
        ...topicPrefixes(command.id).map((topicId) => topicDescriptions.get(topicId) ?? '')
    ].join(ID_SEPARATOR);

/**
 * The best commands for a query: how many distinct query words match a word of the command's text,
 * plus one when a query word matches a word of its id. Commands scoring 0 are left out; ties go by id;
 * at most `SEARCH_MAX_MATCHES`. `topicId` limits it to the commands under one topic.
 */
export const searchCommands: SearchCommandsFn = ({ commands, topics, query, topicId }) => {
    const scope = commands.filter(
        (command) => topicId === undefined || isWithin(command.id, topicId)
    );

    const descriptions = new Map(topics.map((topic) => [topic.id, topic.description]));
    const everyWord = indexWords(scope.map((command) => wordsOf(textOf(command, descriptions))));
    const idWord = indexWords(scope.map((command) => wordsOf(command.id)));
    const queryWords = [...new Set(wordsOf(query))];
    const scores = new Map<number, number>();
    const idMatches = new Set<number>();

    queryWords.forEach((word) => {
        lookup(everyWord, word).forEach((id) => scores.set(id, (scores.get(id) ?? 0) + 1));
        lookup(idWord, word).forEach((id) => idMatches.add(id));
    });

    idMatches.forEach((id) => scores.set(id, (scores.get(id) ?? 0) + SEARCH_ID_BONUS));

    return [...scores.entries()]
        .map(([id, score]) => ({ command: scope[id], score }))
        .flatMap(({ command, score }) => (command ? [{ command, score }] : []))
        .sort((a, b) => b.score - a.score || a.command.id.localeCompare(b.command.id))
        .slice(0, SEARCH_MAX_MATCHES)
        .map(({ command }) => command);
};
