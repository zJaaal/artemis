import path from 'node:path';

import { HELP_WORD, RESERVED_FLAGS, TERMINATOR } from '../constants.js';
import { UsageError } from '../errors/errors.js';
import type {
    CheckNewFn,
    CommandFileFn,
    NewSpec,
    NewWords,
    ParseNewWordsFn,
    RenderCommandFn
} from '../models.js';
import { isFlagToken } from '../utils/flag-token.js';
import {
    COMMAND_FILE_EXTENSION,
    IDENTIFIER_PATTERN,
    NEW_FLAGS,
    NEW_INDENT,
    NEWLINE_PATTERN,
    NEW_NAME_PATTERN,
    NEW_PLACEHOLDER,
    NEW_PLAN_PLACEHOLDER,
    NEW_PRINT_WIDTH,
    NEW_USAGE_LINE,
    NEW_VALUE_FLAGS,
    NEW_WORD,
    NEW_WORD_PATTERN,
    NEW_WORK_COMMENT,
    WORD_NAMES
} from './constants.js';

// Pure: the words after `new`, what they mean, where the file goes and what it holds.

const usageError = (message: string, hint: string): UsageError =>
    new UsageError(message, { usage: NEW_USAGE_LINE, hint });

const NO_WORDS: NewWords = {
    words: [],
    description: undefined,
    args: [],
    flags: [],
    destructive: false,
    supportsDryRun: false,
    json: false,
    quiet: false,
    help: false
};

const EQUALS = '=';

/** `--x=value` as its name and value; `--x` has no inline value. */
function splitInline(word: string): { name: string; inline: string | undefined } {
    const at = word.indexOf(EQUALS);

    return word.startsWith(TERMINATOR) && at > 0
        ? { name: word.slice(0, at), inline: word.slice(at + 1) }
        : { name: word, inline: undefined };
}

/** Applies a flag that stands alone; an unknown one (`--yes`, `--dry-run`, `--log` too) is a usage error. */
function applyFlag(read: NewWords, flag: string): NewWords | UsageError {
    switch (flag) {
        case NEW_FLAGS.json:
            return { ...read, json: true };
        case NEW_FLAGS.help:
        case NEW_FLAGS.helpShort:
            return { ...read, help: true };
        case NEW_FLAGS.quiet:
            return { ...read, quiet: true };
        case NEW_FLAGS.destructive:
            return { ...read, destructive: true };
        case NEW_FLAGS.supportsDryRun:
            return { ...read, supportsDryRun: true };
        default:
            return usageError(
                `Unknown option "${flag}"`,
                `${NEW_WORD} takes ${NEW_FLAGS.description}, ${NEW_FLAGS.arg}, ${NEW_FLAGS.flag}, ${NEW_FLAGS.destructive}, ${NEW_FLAGS.supportsDryRun}, ${NEW_FLAGS.quiet}, ${NEW_FLAGS.json} and ${NEW_FLAGS.help}.`
            );
    }
}

/** Applies a flag that takes a value; `--description` twice is a usage error. */
function applyValue(read: NewWords, name: string, value: string): NewWords | UsageError {
    if (name === NEW_FLAGS.arg) {
        return { ...read, args: [...read.args, value] };
    }

    if (name === NEW_FLAGS.flag) {
        return { ...read, flags: [...read.flags, value] };
    }

    return read.description === undefined
        ? { ...read, description: value }
        : usageError(`${NEW_FLAGS.description} was given twice`, 'Give the description once.');
}

/**
 * Reads the words after `new`. `-h` and `--help` win over every other problem. `--description`,
 * `--arg` and `--flag` take the word after them as their value, whatever it looks like (or
 * `--x=value`); `--arg` and `--flag` repeat. Any other word that starts with a dash is an unknown
 * option, every other word is a command word, and after `--` everything is. Pure.
 */
export const parseNewWords: ParseNewWordsFn = (words) => {
    let read = NO_WORDS;
    let problem: UsageError | undefined;
    let terminated = false;

    const take = (next: NewWords | UsageError): void => {
        if (next instanceof UsageError) {
            problem ??= next;
        } else {
            read = next;
        }
    };

    for (let index = 0; index < words.length; index++) {
        const word = words[index] ?? '';

        if (!terminated && word === TERMINATOR) {
            terminated = true;
        } else if (terminated || !isFlagToken(word)) {
            read = { ...read, words: [...read.words, word] };
        } else {
            const { name, inline } = splitInline(word);

            if (NEW_VALUE_FLAGS.includes(name)) {
                const value = inline ?? words[index + 1];

                index += inline === undefined ? 1 : 0;

                take(
                    value === undefined || value === ''
                        ? usageError(
                              `${name} needs a value`,
                              `Give it with a space or an equals sign: ${name} <value>`
                          )
                        : applyValue(read, name, value)
                );
            } else {
                take(applyFlag(read, word));
            }
        }
    }

    if (problem !== undefined && !read.help) {
        throw problem;
    }

    return read;
};

/** The first problem with the names of the args and flags, if any. */
function nameProblem(args: readonly string[], flags: readonly string[]): UsageError | undefined {
    const badName = [...args, ...flags].find((name) => !NEW_NAME_PATTERN.test(name));
    const reserved = flags.find((name) => RESERVED_FLAGS.includes(name));
    const twice = [...args, ...flags].find((name, index, all) => all.indexOf(name) !== index);

    if (badName !== undefined) {
        return usageError(
            `"${badName}" is not a valid name`,
            'Names are lowercase letters, digits and dashes, starting with a letter.'
        );
    }

    if (reserved !== undefined) {
        return usageError(
            `--${reserved} is a flag every command has already`,
            `Pick another name for the flag: ${RESERVED_FLAGS.join(', ')} are taken.`
        );
    }

    return twice === undefined
        ? undefined
        : usageError(
              `"${twice}" is used twice`,
              'An arg or a flag can be declared once, and an arg and a flag cannot share a name.'
          );
}

/** The first problem with the command words, if any. */
function wordsProblem(words: readonly string[]): UsageError | undefined {
    const [first] = words;
    const bad = words.find((word) => !NEW_WORD_PATTERN.test(word));

    if (first === undefined) {
        return usageError(
            `${NEW_WORD} needs the words of the command`,
            `Try: ${NEW_WORD} db reset --description "Delete the local database"`
        );
    }

    if (bad !== undefined) {
        return usageError(
            `"${bad}" is not a valid command word`,
            'Words are lowercase letters, digits and dashes, starting with a letter or a digit.'
        );
    }

    return [HELP_WORD, ...WORD_NAMES].includes(first)
        ? usageError(
              `"${first}" is a word of this binary, so it cannot start a command`,
              `A command called "${first}" would be hidden by that word. Pick another first word.`
          )
        : undefined;
}

/** The first problem with the description, if any: it is required, and one line. */
function descriptionProblem(description: string | undefined): UsageError | undefined {
    if (description === undefined || description.trim() === '') {
        return usageError(
            `${NEW_FLAGS.description} is required`,
            `Say what the command does in one line: ${NEW_FLAGS.description} "Delete the local database"`
        );
    }

    return NEWLINE_PATTERN.test(description)
        ? usageError(`${NEW_FLAGS.description} must be one line`, 'Remove the line breaks.')
        : undefined;
}

/** Checks what was typed after `new`; a UsageError (exit 2) says what is wrong. Pure. */
export const checkNew: CheckNewFn = (read) => {
    const problem =
        wordsProblem(read.words) ??
        descriptionProblem(read.description) ??
        nameProblem(read.args, read.flags);

    if (problem !== undefined) {
        throw problem;
    }

    return {
        words: read.words,
        description: read.description ?? '',
        args: read.args,
        flags: read.flags,
        destructive: read.destructive,
        supportsDryRun: read.supportsDryRun
    };
};

/** Where the file of a command id goes: one folder per word but the last, which is the file. */
export const commandFile: CommandFileFn = (commandsDir, words) => {
    const folders = words.slice(0, -1);
    const name = words.at(-1) ?? '';

    return path.join(commandsDir, ...folders, `${name}${COMMAND_FILE_EXTENSION}`);
};

const SINGLE = "'";
const DOUBLE = '"';
const BACKSLASH = '\\';

const countOf = (text: string, character: string): number => text.split(character).length - 1;

/**
 * A JavaScript string literal for any text, quoted the way Prettier leaves it: single quotes, unless
 * the text has more single than double quotes. Backslashes and the quote used are escaped.
 */
function quoted(text: string): string {
    const quote = countOf(text, SINGLE) > countOf(text, DOUBLE) ? DOUBLE : SINGLE;

    const escaped = text
        .replaceAll(BACKSLASH, `${BACKSLASH}${BACKSLASH}`)
        .replaceAll(quote, `${BACKSLASH}${quote}`);

    return `${quote}${escaped}${quote}`;
}

const fits = (line: string): boolean => line.length <= NEW_PRINT_WIDTH;

/**
 * One object, flat on one line when it fits (with what follows it), else one property per line:
 * what Prettier makes of an object written either way.
 */
function objectLines(
    indent: string,
    key: string,
    properties: readonly string[],
    suffix: string
): string[] {
    const head = key === '' ? '' : `${key}: `;
    const flat = `${indent}${head}{ ${properties.join(', ')} }${suffix}`;

    return fits(flat)
        ? [flat]
        : [
              `${indent}${head}{`,
              ...properties.map(
                  (property, index) =>
                      `${indent}${NEW_INDENT}${property}${index < properties.length - 1 ? ',' : ''}`
              ),
              `${indent}}${suffix}`
          ];
}

const argProperties = (name: string): string[] => [
    `name: ${quoted(name)}`,
    'required: true',
    `description: ${quoted(NEW_PLACEHOLDER)}`
];

const flagProperties = (): string[] => [
    'type: ' + quoted('boolean'),
    `description: ${quoted(NEW_PLACEHOLDER)}`
];

/** The `args` field. Prettier breaks an array of several objects, and a single one only when it does not fit. */
function argsLines(names: readonly string[]): string[] {
    const inner = `${NEW_INDENT}${NEW_INDENT}`;
    const [only] = names;

    if (names.length === 1 && only !== undefined) {
        const flat = `${NEW_INDENT}args: [{ ${argProperties(only).join(', ')} }],`;

        if (fits(flat)) {
            return [flat];
        }
    }

    return [
        `${NEW_INDENT}args: [`,
        ...names.flatMap((name, index) =>
            objectLines(inner, '', argProperties(name), index < names.length - 1 ? ',' : '')
        ),
        `${NEW_INDENT}],`
    ];
}

/** A flag name as an object key: quoted only when it is not a plain identifier, as Prettier leaves it. */
const flagKey = (name: string): string => (IDENTIFIER_PATTERN.test(name) ? name : quoted(name));

/** The `flags` field: one object, flat when it fits. */
function flagsLines(names: readonly string[]): string[] {
    const inner = `${NEW_INDENT}${NEW_INDENT}`;

    const flatEntry = (name: string): string =>
        `${flagKey(name)}: { ${flagProperties().join(', ')} }`;

    const flat = `${NEW_INDENT}flags: { ${names.map(flatEntry).join(', ')} },`;

    if (fits(flat)) {
        return [flat];
    }

    return [
        `${NEW_INDENT}flags: {`,
        ...names.flatMap((name, index) =>
            objectLines(inner, flagKey(name), flagProperties(), index < names.length - 1 ? ',' : '')
        ),
        `${NEW_INDENT}},`
    ];
}

/** The description line: a string too long for the line goes under its key, as Prettier puts it. */
function descriptionLines(description: string): string[] {
    const line = `${NEW_INDENT}description: ${quoted(description)},`;

    return fits(line)
        ? [line]
        : [`${NEW_INDENT}description:`, `${NEW_INDENT}${NEW_INDENT}${quoted(description)},`];
}

/** What `run` hands back: the args and flags that exist, or null when there are none. */
function returnLine({ args, flags }: NewSpec): string {
    const present = [args.length ? 'args' : '', flags.length ? 'flags' : ''].filter(Boolean);

    return present.length ? `return { ${present.join(', ')} };` : 'return null;';
}

/** The parameters `run` lists: only what exists, and always `ctx`. */
function runParameters({ args, flags }: NewSpec): string {
    return [args.length ? 'args' : '', flags.length ? 'flags' : '', 'ctx']
        .filter(Boolean)
        .join(', ');
}

/** The dry-run block of a command that says it honors `--dry-run`. */
function dryRunLines(): string[] {
    const body = `${NEW_INDENT}${NEW_INDENT}`;

    return [
        `${body}ctx.plan(${quoted(NEW_PLAN_PLACEHOLDER)});`,
        `${body}if (ctx.dryRun) {`,
        `${body}${NEW_INDENT}return null;`,
        `${body}}`,
        ''
    ];
}

/**
 * The file `new` writes: a working stub that passes `defineCommand` and runs, laid out the way
 * Prettier leaves it under this repository's settings. Pure.
 */
export const renderCommand: RenderCommandFn = (spec) => {
    const body = `${NEW_INDENT}${NEW_INDENT}`;

    const lines = [
        '// @ts-check',
        "import { defineCommand } from '@zjaaal/artemis';",
        '',
        'export default defineCommand({',
        ...descriptionLines(spec.description),
        ...(spec.destructive ? [`${NEW_INDENT}destructive: true,`] : []),
        ...(spec.supportsDryRun ? [`${NEW_INDENT}dryRun: true,`] : []),
        ...(spec.args.length ? argsLines(spec.args) : []),
        ...(spec.flags.length ? flagsLines(spec.flags) : []),
        `${NEW_INDENT}run({ ${runParameters(spec)} }) {`,
        ...(spec.supportsDryRun ? dryRunLines() : []),
        `${body}${NEW_WORK_COMMENT}`,
        `${body}${returnLine(spec)}`,
        `${NEW_INDENT}}`,
        '});',
        ''
    ];

    return lines.join('\n');
};
