import { findLocalCopy, readRunningPackage } from '../edges/package-info.js';
import type { Project, Style } from '../models.js';
import { VERSION_WARNING_LABEL } from '../constants.js';
import { rangeOf, versionWarningLine } from './install-checks.js';

/**
 * The one line the shipped binary prints to stderr when the Artemis that runs is not the one the
 * project wants (its range) or installed (its own copy): `art` kept running an old `0.1.1` once and
 * nothing said so. It is cheap: the project's package.json is already read, plus one from
 * node_modules. Undefined when there is nothing to say. It is never part of the JSON envelope.
 */
export const versionWarning = (project: Project, style: Style): string | undefined => {
    const line = versionWarningLine({
        running: readRunningPackage(),
        range: rangeOf(project.manifest),
        local: findLocalCopy(project.root)
    });

    return line === undefined ? undefined : `${style.yellow(VERSION_WARNING_LABEL)} ${line}`;
};
