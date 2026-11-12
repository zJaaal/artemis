import { ARTEMIS_PACKAGE, DEPENDENCY_FIELDS, DOCTOR_COMMAND_HINT } from '../constants.js';
import type { DoctorCheck, InstallCheckFn, InstallFacts, RangeOfFn } from '../models.js';
import { isRecord } from '../utils/is-record.js';
import { checkRange, parseVersion } from '../utils/semver.js';

// Pure: the `range` and `installed` checks. The doctor reports them, and the every-run warning
// reads the same two, so both always say the same thing.

/** The range a manifest wants for Artemis, from `dependencies` or else `devDependencies`. */
export const rangeOf: RangeOfFn = (manifest) => {
    const wanted = DEPENDENCY_FIELDS.map((field) => manifest[field])
        .filter(isRecord)
        .map((fields) => fields[ARTEMIS_PACKAGE])
        .find((range) => typeof range === 'string');

    return typeof wanted === 'string' ? wanted : undefined;
};

/** The project's range for Artemis against the version that is running. */
export const rangeCheck: InstallCheckFn = ({ running, range }): DoctorCheck => {
    if (range === undefined) {
        return {
            id: 'range',
            status: 'ok',
            message: `This project does not depend on ${ARTEMIS_PACKAGE}.`
        };
    }

    if (parseVersion(running.version) === undefined) {
        return { id: 'range', status: 'ok', message: 'not checked: running a prerelease' };
    }

    const verdict = checkRange(running.version, range);

    if (verdict === 'not-checked') {
        return { id: 'range', status: 'ok', message: `not checked: ${range}` };
    }

    if (verdict === 'satisfied') {
        return { id: 'range', status: 'ok', message: `${running.version} satisfies ${range}.` };
    }

    return {
        id: 'range',
        status: 'warn',
        message: `art ${running.version} is running; this project wants ${range}.`,
        fix: `Run npx art, or update the global art to a version that satisfies ${range}.`
    };
};

/** The project's own copy of Artemis against the version that is running. */
export const installedCheck: InstallCheckFn = ({ running, local }): DoctorCheck => {
    if (local === undefined) {
        return {
            id: 'installed',
            status: 'ok',
            message: `not installed in this project; running ${running.version} from ${running.root}`
        };
    }

    if (local.version === running.version) {
        return {
            id: 'installed',
            status: 'ok',
            message: `${running.version} is the copy this project installs.`
        };
    }

    return {
        id: 'installed',
        status: 'warn',
        message: `art ${running.version} is running; this project installs ${local.version}.`,
        fix: 'Run npx art, or update the global art.'
    };
};

/**
 * The one line the every-run warning prints, or undefined when neither check warns. When both warn
 * it names both facts: one line however many there are.
 */
export const versionWarningLine = (facts: InstallFacts): string | undefined => {
    const range = rangeCheck(facts);
    const installed = installedCheck(facts);
    const { running, local } = facts;
    const wants = range.status === 'warn' ? ` this project wants ${facts.range}` : '';
    const installs = installed.status === 'warn' ? ` this project installs ${local?.version}` : '';
    const joined = [wants, installs].filter(Boolean).join(' and');

    if (!joined) {
        return undefined;
    }

    return `art ${running.version} is running;${joined}. ${DOCTOR_COMMAND_HINT}`;
};
