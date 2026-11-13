import { parseArgs } from 'node:util';

import { ERROR_SENTENCE_SEPARATOR, GLOBAL_FLAGS } from '../constants.js';
import { UsageError } from '../errors/errors.js';
import { messageOf } from '../utils/error-message.js';
import type {
    ArgDefinition,
    ArgDefinitions,
    ChoiceCheck,
    FlagDefinition,
    FlagDefinitions,
    GlobalFlags,
    ParseFn,
    ParseOptionDescriptor,
    ParseOptions,
    ParsedValues
} from '../models.js';

// parseArgs wants a mutable array for a repeatable flag's default
const toParseDefault = (value: NonNullable<FlagDefinition['default']>) =>
    typeof value === 'object' ? [...value] : value;

function toParseOption(flag: FlagDefinition): ParseOptionDescriptor {
    return {
        type: flag.type,
        ...(flag.short ? { short: flag.short } : {}),
        ...(flag.multiple ? { multiple: true } : {}),
        ...(flag.default !== undefined ? { default: toParseDefault(flag.default) } : {})
    };
}

const toParseOptions = (flags: FlagDefinitions): ParseOptions =>
    Object.fromEntries(Object.entries(flags).map(([name, flag]) => [name, toParseOption(flag)]));

// Node appends a paragraph about "--" to unknown option errors; the first sentence is the useful part
const firstSentence = (message: string): string =>
    message.split(ERROR_SENTENCE_SEPARATOR)[0] ?? message;

function parseCommandLine(argv: readonly string[], options: ParseOptions, usage: string) {
    try {
        return parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
    } catch (error) {
        throw new UsageError(firstSentence(messageOf(error)), { usage, fromCommand: true });
    }
}

const readGlobalFlags = (values: ParsedValues): GlobalFlags => ({
    help: Boolean(values.help),
    json: Boolean(values.json),
    yes: Boolean(values.yes),
    dryRun: Boolean(values['dry-run']),
    quiet: Boolean(values.quiet),
    log: typeof values.log === 'string' ? values.log : undefined
});

function checkChoice({ kind, name, value, choices, usage }: ChoiceCheck): void {
    const allowed: readonly unknown[] = choices ?? [];

    const isOutsideChoices =
        choices !== undefined && value !== undefined && !allowed.includes(value);

    if (isOutsideChoices) {
        throw new UsageError(
            `Invalid ${kind} "${name}": "${String(value)}". Allowed: ${choices.join(', ')}`,
            { usage, fromCommand: true }
        );
    }
}

function readArg(arg: ArgDefinition, positional: string | undefined, usage: string) {
    const value = positional ?? arg.default;

    if (value === undefined && arg.required) {
        throw new UsageError(`Missing required argument "${arg.name}"`, {
            usage,
            fromCommand: true
        });
    }

    checkChoice({ kind: 'argument', name: arg.name, value, choices: arg.choices, usage });

    return value;
}

function readArgs(args: ArgDefinitions, positionals: string[], usage: string) {
    const extra = positionals[args.length];

    if (extra !== undefined) {
        throw new UsageError(`Unexpected argument "${extra}"`, { usage, fromCommand: true });
    }

    return Object.fromEntries(
        args.map((arg, index) => [arg.name, readArg(arg, positionals[index], usage)])
    );
}

function checkFlagChoices(definitions: FlagDefinitions, values: ParsedValues, usage: string) {
    Object.entries(definitions).forEach(([name, flag]) => {
        [values[name]].flat().forEach((value) =>
            checkChoice({
                kind: 'value for flag',
                name: `--${name}`,
                value,
                choices: flag.choices,
                usage
            })
        );
    });
}

/**
 * Parses the words after the command name into its args and flags, plus the global flags.
 * With --help nothing is validated, so help works even when required args are missing.
 *
 * @throws {UsageError} on unknown flags, missing or extra args, and values outside `choices`.
 */
export const parse: ParseFn = (definition, argv, usage) => {
    const options = toParseOptions({ ...definition.flags, ...GLOBAL_FLAGS });
    const { values, positionals } = parseCommandLine(argv, options, usage);
    const global = readGlobalFlags(values);

    const flags = Object.fromEntries(
        Object.keys(definition.flags).map((name) => [name, values[name]])
    );

    if (global.help) {
        return { args: {}, flags, global };
    }

    const args = readArgs(definition.args, positionals, usage);

    checkFlagChoices(definition.flags, values, usage);

    return { args, flags, global };
};
