import {
    ALIAS_SEPARATOR,
    FLAG_PREFIX,
    HELP_WORD,
    ID_SEPARATOR,
    GLOBAL_FLAG_TOKENS,
    SUGGEST_LENGTH_DIVISOR,
    SUGGEST_MIN_DISTANCE,
    TERMINATOR
} from '../constants.js';
import type {
    CommandEntry,
    FindCommandFn,
    IsGlobalFlagTokenFn,
    Registry,
    ResolveFn,
    Resolution,
    SplitLeadingFlagsFn,
    SuggestFn,
    TopicEntry
} from '../models.js';

/** One row of the edit-distance table, from the row above it. */
function nextRow(previous: number[], char: string, target: string, rowNumber: number): number[] {
    const row = [rowNumber];

    target.split('').forEach((targetChar, index) => {
        const substitution = (previous[index] ?? 0) + (char === targetChar ? 0 : 1);
        const deletion = (previous[index + 1] ?? 0) + 1;
        const insertion = (row[index] ?? 0) + 1;

        row.push(Math.min(substitution, deletion, insertion));
    });

    return row;
}

function editDistance(a: string, b: string): number {
    const firstRow = Array.from({ length: b.length + 1 }, (_, index) => index);

    const lastRow = a
        .split('')
        .reduce((previous, char, index) => nextRow(previous, char, b, index + 1), firstRow);

    return lastRow[b.length] ?? 0;
}

const maxSuggestDistance = (name: string): number =>
    Math.max(SUGGEST_MIN_DISTANCE, Math.floor(name.length / SUGGEST_LENGTH_DIVISOR));

/** The closest command, topic or alias name, if one is close enough to be a likely typo. */
export const suggest: SuggestFn = (registry, name, extraNames = []) => {
    const names = [
        ...registry.commands.keys(),
        ...registry.topics.keys(),
        ...registry.aliases.keys(),
        ...extraNames
    ];

    const [best] = names
        .map((candidate) => ({ candidate, score: editDistance(name, candidate) }))
        .sort((a, b) => a.score - b.score);

    return best && best.score <= maxSuggestDistance(name) ? best.candidate : undefined;
};

/** A command by id or by alias. */
export const findCommand: FindCommandFn = (registry, id) => {
    const aliased = registry.aliases.get(id);

    return registry.commands.get(id) ?? (aliased ? registry.commands.get(aliased) : undefined);
};

const isFlagToken = (token: string): boolean => token.startsWith(FLAG_PREFIX);

/** The words that can name a command: everything before the first flag. */
function leadingWords(tokens: string[]): string[] {
    const firstFlag = tokens.findIndex(isFlagToken);

    return firstFlag === -1 ? tokens : tokens.slice(0, firstFlag);
}

// "uve" and "uve help" both show the topic; anything else after a topic is unknown
const isHelpAfterTopic = (words: string[], length: number): boolean =>
    length === words.length - 1 && words[length] === HELP_WORD;

const isTopicOnly = (words: string[], length: number): boolean =>
    length === words.length || isHelpAfterTopic(words, length);

function resolveTopic(
    topic: TopicEntry,
    words: string[],
    length: number,
    tokens: string[]
): Resolution {
    return isTopicOnly(words, length)
        ? { kind: 'topic', topic, rest: tokens.slice(length) }
        : { kind: 'unknown', name: words.slice(0, length + 1).join(ID_SEPARATOR) };
}

function matchLongest(
    registry: Registry,
    tokens: string[],
    words: string[]
): Resolution | undefined {
    for (let length = words.length; length > 0; length--) {
        const id = words.slice(0, length).join(ID_SEPARATOR);
        const command: CommandEntry | undefined = registry.commands.get(id);
        const topic = registry.topics.get(id);

        if (command) {
            return { kind: 'command', entry: command, rest: tokens.slice(length) };
        }

        if (topic) {
            return resolveTopic(topic, words, length, tokens);
        }
    }

    return undefined;
}

/**
 * Works out which command (or topic) the command line names. Words are matched greedily, so
 * `uve config set http://x` is the command `uve config set` with `http://x` left as its argument.
 * `uve:config:set` and declared aliases are accepted as well, and a topic followed by `help` (`uve help`)
 * shows that topic.
 */
export const resolve: ResolveFn = (registry, argv) => {
    const [first, ...others] = argv;

    if (first === undefined) {
        return { kind: 'unknown', name: '' };
    }

    const aliased = registry.aliases.has(first) ? findCommand(registry, first) : undefined;

    if (aliased) {
        return { kind: 'command', entry: aliased, rest: others };
    }

    const tokens = first.includes(ALIAS_SEPARATOR)
        ? [...first.split(ALIAS_SEPARATOR), ...others]
        : [...argv];

    const words = leadingWords(tokens);

    return matchLongest(registry, tokens, words) ?? { kind: 'unknown', name: words[0] ?? first };
};

export const isGlobalFlagToken: IsGlobalFlagTokenFn = (token) => GLOBAL_FLAG_TOKENS.includes(token);

/**
 * Splits off the flags typed before the command name (`art --json math add 1 2`). They belong to
 * the run, not to a command; `--` ends them like it ends any flags.
 */
export const splitLeadingFlags: SplitLeadingFlagsFn = (argv) => {
    const firstWord = argv.findIndex((token) => !isFlagToken(token) || token === TERMINATOR);
    const end = firstWord === -1 ? argv.length : firstWord;

    return { leading: argv.slice(0, end), rest: argv.slice(end) };
};
