import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_KEY, DEFAULT_COMMANDS_FOLDER, MANIFEST_FILE, URL_LIKE } from '../constants.js';
import { isFolder, readManifest } from '../edges/files.js';
import { currentProcess } from '../edges/process.js';
import { workingDirectory } from '../edges/system.js';
import { CommandError } from '../errors/errors.js';
import type { CliFn, CliRoute, FolderOfRootFn, HostOptions, SettingsForFn } from '../models.js';
import { reportError } from '../run/report.js';
import { run } from '../run/run.js';
import { resolveWorld } from '../run/world.js';
import { messageOf } from '../utils/error-message.js';
import { jsonRequested } from '../utils/terminator.js';
import { findProject, resolveSettings } from './settings.js';

/** What `root` stands for as a path, or a CommandError that says what to pass instead. */
function pathOfRoot(root: string | URL): string {
    try {
        if (typeof root === 'string' && root !== '' && !URL_LIKE.test(root)) {
            return root;
        }

        return fileURLToPath(root);
    } catch (error) {
        throw new CommandError(
            `cli({ root }) needs the location of your bin file, but got ${String(root)} (${messageOf(error)})`,
            {
                hint: 'Pass import.meta.url from your bin file, or a path.'
            }
        );
    }
}

/** The folder a bin file is in (`import.meta.url`), or the folder itself when given one. */
const folderOfRoot: FolderOfRootFn = (root) => {
    const target = pathOfRoot(root);

    return isFolder(target) ? target : path.dirname(target);
};

/** What to do when no project is found: the end user can change folder, the author of a tool cannot. */
const noProjectError = (start: string, route: CliRoute): CommandError =>
    new CommandError(`No project found from ${start} upwards`, {
        hint:
            route === 'own'
                ? `This tool has no ${MANIFEST_FILE} to find its commands from. If you maintain it, ship ${MANIFEST_FILE} and a ${DEFAULT_COMMANDS_FOLDER}/ folder in the package (see "files" in ${MANIFEST_FILE}).`
                : `A project is the nearest ${MANIFEST_FILE} that says more than "type" (a bare { "type": "module" } is a marker, not a project). Run it inside one, with a ${DEFAULT_COMMANDS_FOLDER}/ folder next to it.`
    });

/** The commands folder is missing: say what to create or point at, and for a published tool, who has to. */
const missingCommandsError = (commandsDir: string, manifestPath: string, route: CliRoute) =>
    new CommandError(`Commands folder not found: ${commandsDir}`, {
        hint:
            `Create ${commandsDir}, or set "${CONFIG_KEY}": { "commandsDir" } in ${manifestPath}. ` +
            `If the commands live in a parent folder, point commandsDir at them, for example "../commands".` +
            (route === 'own'
                ? ` If this is a published tool, its author has to ship the commands folder (add it to "files" in ${MANIFEST_FILE}).`
                : '')
    });

/** The project of a folder and where its commands are, or a CommandError that says what to create. */
const settingsFor: SettingsForFn = (start, route) => {
    // The messages name no binary: it is not known here what the user typed (art, artemis or a tool's name).
    const project = findProject(start, readManifest, isFolder);

    if (!project) {
        throw noProjectError(start, route);
    }

    const settings = resolveSettings(project, route);

    if (!isFolder(settings.commandsDir)) {
        throw missingCommandsError(
            settings.commandsDir,
            path.join(project.root, MANIFEST_FILE),
            route
        );
    }

    return settings;
};

/** A setup failure goes out the way any failure does: one object under --json, text otherwise. */
function reportSetupFailure(argv: string[], error: unknown, host: HostOptions): number {
    const { io, style } = resolveWorld(host);

    return reportError(error, { io, style, json: jsonRequested(argv), commandId: undefined });
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

    let settings;

    try {
        const start = path.resolve(
            root === undefined ? (cwd ?? workingDirectory()) : folderOfRoot(root)
        );

        settings = settingsFor(start, route);
    } catch (error) {
        return reportSetupFailure(argv, error, host);
    }

    return run(argv, { ...host, ...settings });
};
