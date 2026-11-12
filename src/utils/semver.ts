import {
    RANGE_OPERATORS,
    RANGE_OR,
    RANGE_PRERELEASE_MARKS,
    RANGE_WILDCARDS,
    VERSION_PARTS_MAX,
    VERSION_PART,
    VERSION_PREFIXES,
    VERSION_SEPARATOR,
    WHITESPACE
} from '../constants.js';
import type {
    Bound,
    CheckRangeFn,
    ParseVersionFn,
    RangeBody,
    RangeVerdict,
    Version
} from '../models.js';

// Pure: our own small range checker, so Artemis needs no `semver` package. It follows npm's meaning
// for the forms it understands, and says "not checked" for the rest.

const isNumber = (part: string): boolean => VERSION_PART.test(part);
const isWildcard = (part: string): boolean => RANGE_WILDCARDS.includes(part);

/** `1.2.3` as numbers. A prerelease, build metadata or anything that is not three numbers is undefined. */
export const parseVersion: ParseVersionFn = (text) => {
    const parts = text.split(VERSION_SEPARATOR);
    const [major, minor, patch] = parts.map(Number);

    const isPlain = parts.length === VERSION_PARTS_MAX && parts.every(isNumber);

    return isPlain && major !== undefined && minor !== undefined && patch !== undefined
        ? [major, minor, patch]
        : undefined;
};

/** Negative when `a` is lower, zero when equal, positive when `a` is higher. */
function compare(a: Version, b: Version): number {
    const [first] = a.map((part, index) => part - (b[index] ?? 0)).filter((delta) => delta !== 0);

    return first ?? 0;
}

const meets = (version: Version, { op, version: limit }: Bound): boolean => {
    const order = compare(version, limit);

    switch (op) {
        case '>=':
            return order >= 0;
        case '>':
            return order > 0;
        case '<=':
            return order <= 0;
        case '<':
            return order < 0;
        case '=':
            return order === 0;
    }
};

/** The numbers of a body: `1.x` and `1` both give [1]; a `*` first part gives []. Undefined when it is no version at all. */
function readRangeBody(text: string): RangeBody | undefined {
    const parts = text.split(VERSION_SEPARATOR);
    const wildcardAt = parts.findIndex(isWildcard);
    const given = wildcardAt === -1 ? parts : parts.slice(0, wildcardAt);

    const isVersion =
        parts.length <= VERSION_PARTS_MAX &&
        given.every(isNumber) &&
        parts.slice(given.length).every(isWildcard);

    return isVersion ? { numbers: given.map(Number) } : undefined;
}

const pad = (numbers: readonly number[]): Version => [
    numbers[0] ?? 0,
    numbers[1] ?? 0,
    numbers[2] ?? 0
];

/** `1.2` and `1.2.x` are 1.2.0 up to, not including, 1.3.0; `1` is up to 2.0.0; a full version is itself. */
function xRange({ numbers }: RangeBody): Bound[] {
    if (numbers.length === 0) {
        return [];
    }

    if (numbers.length === VERSION_PARTS_MAX) {
        return [{ op: '=', version: pad(numbers) }];
    }

    const [major = 0, minor = 0] = numbers;
    const upper: Version = numbers.length === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0];

    return [
        { op: '>=', version: pad(numbers) },
        { op: '<', version: upper }
    ];
}

/** `^` keeps what is left of the first non-zero part: ^1.2.3 is <2.0.0, ^0.1.2 is <0.2.0, ^0.0.3 is <0.0.4. */
function caret({ numbers }: RangeBody): Bound[] {
    const [major = 0, minor = 0, patch = 0] = numbers;
    const keepsMajor = major !== 0 || numbers.length === 1;
    const keepsMinor = minor !== 0 || numbers.length === 2;
    const stops: Version = keepsMajor ? [major + 1, 0, 0] : [0, minor + 1, 0];
    const upper: Version = keepsMajor || keepsMinor ? stops : [0, 0, patch + 1];

    return [
        { op: '>=', version: pad(numbers) },
        { op: '<', version: upper }
    ];
}

/** `~1.2.3` is <1.3.0 and `~1` is <2.0.0. */
function tilde({ numbers }: RangeBody): Bound[] {
    const [major = 0, minor = 0] = numbers;
    const upper: Version = numbers.length === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0];

    return [
        { op: '>=', version: pad(numbers) },
        { op: '<', version: upper }
    ];
}

/** The operator a comparator starts with (longest first, so `>=` is not read as `>`), and the rest. */
function splitOperator(text: string): { op: string; rest: string } {
    const op = RANGE_OPERATORS.find((candidate) => text.startsWith(candidate)) ?? '';

    return { op, rest: text.slice(op.length) };
}

const withoutPrefix = (text: string): string =>
    VERSION_PREFIXES.some((prefix) => text.startsWith(prefix)) ? text.slice(1) : text;

/** The bounds of one comparator (`^1.2.3`, `>=1.0.0`, `1.x`), or undefined when it is a form we do not understand. */
function boundsOf(comparator: string): Bound[] | undefined {
    const { op, rest } = splitOperator(comparator);
    const body = readRangeBody(withoutPrefix(rest));

    if (body === undefined) {
        return undefined;
    }

    const isFull = body.numbers.length === VERSION_PARTS_MAX;

    switch (op) {
        case '':
        case '=':
            return xRange(body);
        case '^':
            return body.numbers.length ? caret(body) : [];
        case '~':
            return body.numbers.length ? tilde(body) : [];
        default:
            // A comparison against a partial version is left to npm: only full versions are checked
            return isFull ? [{ op: op as Bound['op'], version: pad(body.numbers) }] : undefined;
    }
}

/** Satisfied, unsatisfied, or undefined for a range part we do not understand. */
function checkPart(version: Version, part: string): boolean | undefined {
    const text = part.trim();
    const hasPrerelease = RANGE_PRERELEASE_MARKS.some((mark) => text.includes(mark));
    const isSpaceJoined = WHITESPACE.test(text);

    if (text === '' || hasPrerelease || isSpaceJoined) {
        return undefined;
    }

    const bounds = boundsOf(text);

    return bounds === undefined ? undefined : bounds.every((bound) => meets(version, bound));
}

/**
 * Whether `version` is inside `range`, for the forms npm users write most: an exact version (with an
 * optional `v` or `=`), `^`, `~`, `>=`, `>`, `<=`, `<`, `*`, `x`-ranges and partials (`1`, `1.2`,
 * `1.x`), and `||` between them. Everything else (`workspace:`, `file:`, `link:`, a git URL, a tag, a
 * space-joined or hyphen range, a range with a prerelease) is `not-checked`, and so is a `version`
 * that is a prerelease: a warning is never given for a form this does not understand.
 */
export const checkRange: CheckRangeFn = (version, range): RangeVerdict => {
    const parsed = parseVersion(version);

    if (parsed === undefined) {
        return 'not-checked';
    }

    const verdicts = range.split(RANGE_OR).map((part) => checkPart(parsed, part));

    if (verdicts.includes(true)) {
        return 'satisfied';
    }

    return verdicts.includes(undefined) ? 'not-checked' : 'unsatisfied';
};
