import {
    COMMAND_TAG,
    FLAG_TYPES,
    RESERVED_FLAGS,
    RESERVED_SHORTS,
    SHORT_FLAG_LENGTH,
    TOPIC_TAG
} from '../constants.js';
import type {
    ArgDefinition,
    ArgDefinitions,
    Command,
    DefineCommandFn,
    DefineTopicFn,
    FlagDefinition,
    IsCommandFn,
    IsTopicFn,
    Topic
} from '../models.js';
import { hasTag } from '../utils/tag.js';

function fail(message: string): never {
    throw new TypeError(`defineCommand: ${message}`);
}

// A JavaScript caller can hand over a null arg, so the optional chaining is deliberate.
const isOptional = (arg: ArgDefinition): boolean => !arg?.required;

const isRequiredAfterOptional = (arg: ArgDefinition, index: number, firstOptional: number) =>
    Boolean(arg.required) && firstOptional !== -1 && index > firstOptional;

const isRequiredWithDefault = (arg: ArgDefinition) =>
    Boolean(arg.required) && arg.default !== undefined;

function validateArgs(args: ArgDefinitions): void {
    const firstOptional = args.findIndex(isOptional);

    args.forEach((arg, index) => {
        if (!arg?.name) {
            fail('every arg needs a name');
        }

        if (isRequiredWithDefault(arg)) {
            fail(`arg "${arg.name}" cannot be required and have a default`);
        }

        if (isRequiredAfterOptional(arg, index, firstOptional)) {
            fail(`required arg "${arg.name}" cannot come after an optional one`);
        }
    });
}

/** `destructive` and `dryRun` are markers an agent reads, so a truthy string or a number is a mistake. */
function validateMarker(name: string, value: unknown): void {
    if (typeof value !== 'boolean') {
        fail(`${name} must be true or false`);
    }
}

const isReservedShort = (flag: FlagDefinition): boolean =>
    Boolean(flag.short) && RESERVED_SHORTS.includes(flag.short ?? '');

const isMultiCharacterShort = (flag: FlagDefinition): boolean =>
    flag.short !== undefined && flag.short.length !== SHORT_FLAG_LENGTH;

/** What the default of a flag has to be for the parser to accept it. */
function expectedDefault({ type, multiple }: FlagDefinition): string {
    if (type === 'boolean') {
        return 'a boolean';
    }

    return multiple ? 'an array of strings' : 'a string';
}

function hasDefaultOfWrongType({ type, multiple, default: value }: FlagDefinition): boolean {
    if (value === undefined) {
        return false;
    }

    if (type === 'boolean') {
        return typeof value !== 'boolean';
    }

    if (multiple) {
        return !Array.isArray(value) || value.some((item) => typeof item !== 'string');
    }

    return typeof value !== 'string';
}

function validateFlag(name: string, flag: FlagDefinition): void {
    if (RESERVED_FLAGS.includes(name)) {
        fail(`flag "--${name}" is reserved by Artemis`);
    }

    if (isReservedShort(flag)) {
        fail(`short flag "-${flag.short}" is reserved by Artemis`);
    }

    if (isMultiCharacterShort(flag)) {
        fail(`short flag "-${flag.short}" of "--${name}" must be a single character`);
    }

    if (!FLAG_TYPES.includes(flag.type)) {
        fail(`flag "--${name}" needs type "boolean" or "string"`);
    }

    if (hasDefaultOfWrongType(flag)) {
        fail(`the default of flag "--${name}" must be ${expectedDefault(flag)}`);
    }
}

/**
 * Declares a command. The file's path inside the commands folder gives it its name
 * (`commands/setup/uve.js` is `setup uve`), so the definition only describes what it does.
 *
 * `args` and `flags` are read as constants, so `run` receives them typed: a required or defaulted
 * arg is a string, an optional one may be undefined, and `choices` narrow the type.
 *
 * @throws {TypeError} when the definition breaks a rule (no description, reserved flag, ...).
 */
export const defineCommand: DefineCommandFn = (definition) => {
    // A JavaScript caller can pass nothing at all; the checks below then name what is missing.
    const {
        description,
        run,
        args: declaredArgs,
        flags: declaredFlags,
        aliases = [],
        examples = [],
        destructive = false,
        dryRun = false,
        ...extra
    } = definition ?? {};

    // Casts, not conversions: an omitted `args` or `flags` is the empty default of the type parameter.
    const args = (declaredArgs ?? []) as NonNullable<typeof declaredArgs>;
    const flags = (declaredFlags ?? {}) as NonNullable<typeof declaredFlags>;

    if (typeof description !== 'string' || !description) {
        fail('a description is required');
    }

    if (typeof run !== 'function') {
        fail('a run function is required');
    }

    validateMarker('destructive', destructive);
    validateMarker('dryRun', dryRun);
    validateArgs(args);
    Object.entries(flags).forEach(([name, flag]) => validateFlag(name, flag));

    return Object.freeze({
        [COMMAND_TAG]: true,
        description,
        run,
        args,
        flags,
        aliases,
        examples,
        destructive,
        dryRun,
        ...extra
    });
};

/** Describes a topic folder. Put it in `_topic.js` inside the folder. */
export const defineTopic: DefineTopicFn = ({ description } = {}) =>
    Object.freeze({ [TOPIC_TAG]: true, description: description ?? '' });

export const isCommand: IsCommandFn = (value): value is Command => hasTag(value, COMMAND_TAG);

export const isTopic: IsTopicFn = (value): value is Topic => hasTag(value, TOPIC_TAG);
