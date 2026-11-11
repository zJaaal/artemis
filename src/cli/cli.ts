import path from 'node:path';

import {
    CONFIG_KEY,
    DEFAULT_BIN_NAME,
    DEFAULT_COMMANDS_FOLDER,
    JSON_FLAG,
    MANIFEST_FILE
} from '../constants.js';
import { isFolder, readManifest } from '../edges/files.js';
import { workingDirectory } from '../edges/system.js';
import { CommandError } from '../errors/errors.js';
import type { CliFn, CliOptions, CliSettings, SettingsForFn } from '../models.js';
import { reportError } from '../run/report.js';
import { run } from '../run/run.js';
import { resolveWorld } from '../run/world.js';
import { beforeTerminator } from '../utils/terminator.js';
import { findProject, resolveSettings } from './settings.js';

/** Where the commands of a folder's project are, or a CommandError that says what to create or set. */
const settingsFor: SettingsForFn = (cwd) => {
    const project = findProject(cwd, readManifest);

    if (!project) {
        throw new CommandError(`No ${MANIFEST_FILE} found from ${cwd} upwards`, {
            hint: `Run ${DEFAULT_BIN_NAME} inside a project, or create a ${MANIFEST_FILE} with a ${DEFAULT_COMMANDS_FOLDER}/ folder next to it.`
        });
    }

    const settings = resolveSettings(project);

    if (!isFolder(settings.commandsDir)) {
        const manifestPath = path.join(project.root, MANIFEST_FILE);

        throw new CommandError(`Commands folder not found: ${settings.commandsDir}`, {
            hint: `Create ${settings.commandsDir}, or set "${CONFIG_KEY}": { "commandsDir" } in ${manifestPath}.`
        });
    }

    return settings;
};

/** A setup failure goes out the way any failure does: one object under --json, text otherwise. */
function reportSetupFailure(argv: string[], error: unknown, shared: CliOptions): number {
    const world = resolveWorld({ ...shared, bin: DEFAULT_BIN_NAME, commandsDir: '' });

    return reportError(error, {
        io: world.io,
        style: world.style,
        json: beforeTerminator(argv).includes(JSON_FLAG),
        commandId: undefined
    });
}

/**
 * The shipped `art` / `artemis` command: finds the project for the current folder (its nearest
 * package.json), then runs the command line against that project's commands folder. Returns the
 * exit code and never calls process.exit.
 */
export const cli: CliFn = async (argv, options = {}) => {
    const shared = {
        stdout: options.stdout,
        stderr: options.stderr,
        interactive: options.interactive,
        color: options.color,
        env: options.env
    };

    let settings: CliSettings;

    try {
        settings = settingsFor(path.resolve(options.cwd ?? workingDirectory()));
    } catch (error) {
        return reportSetupFailure(argv, error, shared);
    }

    return run(argv, { ...shared, ...settings });
};
