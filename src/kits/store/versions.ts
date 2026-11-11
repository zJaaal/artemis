import { CommandError } from '../../errors/errors.js';
import { isRecord } from '../../utils/is-record.js';
import {
    CORRUPT_DOCUMENT_HINT,
    DATA_KEY,
    FIRST_VERSION,
    UNVERSIONED,
    UPGRADE_KEY,
    VERSION_KEY
} from './constants.js';
import type {
    AssertUpgradesFn,
    InvalidVersionMessageFn,
    UnwrapVersionFn,
    UpgradeValueFn,
    WrapVersionFn
} from './models.js';

/** Version 0 is the value as it is; from version 1 on it travels as `{ "$version": n, "data": value }`. */
export const wrapVersion: WrapVersionFn = (value, version) =>
    version === UNVERSIONED ? value : { [VERSION_KEY]: version, [DATA_KEY]: value };

/**
 * What a parsed file holds. An object with a numeric `$version` and a `data` key is versioned;
 * anything else is version 0 and the whole value. (A version-0 value that happens to look like the
 * wrapper is read as versioned: only an app writing that key itself gets there.)
 */
export const unwrapVersion: UnwrapVersionFn = (parsed) => {
    const isWrapped =
        isRecord(parsed) && typeof parsed[VERSION_KEY] === 'number' && DATA_KEY in parsed;

    return isWrapped
        ? { version: Number(parsed[VERSION_KEY]), value: parsed[DATA_KEY] }
        : { version: UNVERSIONED, value: parsed };
};

/** A version is a whole number, 0 or more: a file saying -1 or 0.5 was not written by the store. */
export const invalidVersionMessage: InvalidVersionMessageFn = (file, version) =>
    Number.isInteger(version) && version >= UNVERSIONED
        ? undefined
        : `${file} has "${VERSION_KEY}": ${version}, which is not a version: it must be a whole number, 0 or more.`;

/**
 * Brings what a file holds up to the version the code expects, one step at a time. A file newer
 * than the code is refused: guessing at a shape it does not know could lose data.
 */
export const upgradeValue: UpgradeValueFn = (file, found, version, upgrades) => {
    const invalid = invalidVersionMessage(file, found.version);

    if (invalid) {
        throw new CommandError(invalid, { hint: CORRUPT_DOCUMENT_HINT });
    }

    if (found.version > version) {
        throw new CommandError(
            `${file} is version ${found.version}, newer than this code (${version}).`,
            {
                hint: 'Update the app, or reset it to start again from the defaults.'
            }
        );
    }

    const steps = Array.from(
        { length: version - found.version },
        (_, index) => found.version + index + 1
    );

    return steps.reduce<unknown>((value, step) => upgrades[step]?.(value), found.value);
};

/** Every step from 1 to `version` must exist, checked when the document is defined, not when it is read. */
export const assertUpgrades: AssertUpgradesFn = (name, version, upgrades) => {
    if (!Number.isInteger(version) || version < UNVERSIONED) {
        throw new TypeError(
            `Document "${name}" has version ${version}: it must be a whole number, 0 or more.`
        );
    }

    const badKey = Object.keys(upgrades).find((key) => !UPGRADE_KEY.test(key));

    if (badKey !== undefined) {
        throw new TypeError(
            `Document "${name}" has an upgrade keyed "${badKey}": upgrades are keyed by the whole version they produce (1, 2, ...).`
        );
    }

    const steps = Array.from({ length: version }, (_, index) => index + FIRST_VERSION);
    const missing = steps.find((step) => typeof upgrades[step] !== 'function');

    if (missing !== undefined) {
        throw new TypeError(
            `Document "${name}" is version ${version} but has no upgrade to version ${missing}: add upgrades[${missing}].`
        );
    }
};
