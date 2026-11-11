import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_KEY, DEFAULT_COMMANDS_FOLDER, JSON_FLAG, MANIFEST_FILE } from '../constants.js';
import { isFolder, readManifest } from '../edges/files.js';
import { currentProcess } from '../edges/process.js';
import { workingDirectory } from '../edges/system.js';
import { CommandError } from '../errors/errors.js';
import type { CliFn, CliRoute, FolderOfRootFn, HostOptions, SettingsForFn } from '../models.js';
import { reportError } from '../run/report.js';
import { run } from '../run/run.js';
import { resolveWorld } from '../run/world.js';
import { beforeTerminator } from '../utils/terminator.js';
import { findProject, resolveSettings } from './settings.js';

/** The folder a bin file is in (`import.meta.url`), or the folder itself when given one. */
const folderOfRoot: FolderOfRootFn = (root) => {
    const target =
        typeof root === 'string' && !root.startsWith('file:') ? root : fileURLToPath(root);

    return isFolder(target) ? target : path.dirname(target);
};

/** The project of a folder and where its commands are, or a CommandError that says what to create. */
const settingsFor: SettingsForFn = (start, route) => {
    const project = findProject(start, readManifest, isFolder);

    // The messages name no binary: it is not known here what the user typed (art, artemis or a tool's name).
    if (!project) {
        throw new CommandError(`No project found from ${start} upwards`, {
            hint: `A project is a folder with a ${MANIFEST_FILE} and a ${DEFAULT_COMMANDS_FOLDER}/ folder next to it, or an "${CONFIG_KEY}" key in its ${MANIFEST_FILE}. Run it inside a project, or create ${DEFAULT_COMMANDS_FOLDER}/ next to your ${MANIFEST_FILE}.`
        });
    }

    const settings = resolveSettings(project, route);

    if (!isFolder(settings.commandsDir)) {
        const manifestPath = path.join(project.root, MANIFEST_FILE);

        throw new CommandError(`Commands folder not found: ${settings.commandsDir}`, {
            hint: `Create ${settings.commandsDir}, or set "${CONFIG_KEY}": { "commandsDir" } in ${manifestPath}.`
        });
    }

    return settings;
};

/** A setup failure goes out the way any failure does: one object under --json, text otherwise. */
function reportSetupFailure(argv: string[], error: unknown, host: HostOptions): number {
    const { io, style } = resolveWorld(host);

    return reportError(error, {
        io,
        style,
        json: beforeTerminator(argv).includes(JSON_FLAG),
        commandId: undefined
    });
}

/**
 * Finds the project and runs the command line against its commands folder. Returns the exit code
 * and never calls process.exit.
 *
 * With `root` (a project's own bin file: `cli({ root: import.meta.url })`) the project is the one
 * the bin file belongs to, wherever the user is standing. Without it (the shipped `art` and
 * `artemis`) the project is the one of the current folder, or of `cwd`.
 */
export const launch: CliFn = async (options = {}) => {
    const { argv = currentProcess().args, cwd, root, ...host } = options;
    const route: CliRoute = root === undefined ? 'shipped' : 'own';

    const start = path.resolve(
        root === undefined ? (cwd ?? workingDirectory()) : folderOfRoot(root)
    );

    let settings;

    try {
        settings = settingsFor(start, route);
    } catch (error) {
        return reportSetupFailure(argv, error, host);
    }

    return run(argv, { ...host, ...settings });
};
