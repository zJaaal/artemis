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
import { splitLeadingFlags } from '../resolve/resolve.js';
import { jsonRequested } from '../utils/terminator.js';
import { INIT_WORD } from './constants.js';
import { initCommand } from './init-command.js';
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

/** What to do when no project is found: the end user can create one, the author of a tool must declare its bin. */
const noProjectError = (start: string, route: CliRoute): CommandError =>
    route === 'own'
        ? new CommandError(`No ${MANIFEST_FILE} with a "bin" field found from ${start} upwards`, {
              hint: `A published tool is found through the ${MANIFEST_FILE} that declares its "bin" (npm needs it to create the command anyway). If you maintain this tool, declare "bin" there and ship a ${DEFAULT_COMMANDS_FOLDER}/ folder in the package (see "files" in ${MANIFEST_FILE}).`
          })
        : new CommandError(`No project found from ${start} upwards`, {
              hint: `A project is the nearest ${MANIFEST_FILE} with an "${CONFIG_KEY}" key or a ${DEFAULT_COMMANDS_FOLDER}/ folder next to it. Run it inside one, or use its "${INIT_WORD}" command in this folder to create one.`
          });

/** Whether the commands folder is already outside the project, so pointing it at a parent is no news. */
const pointsOutside = (commandsDir: string, projectRoot: string): boolean =>
    path.relative(projectRoot, commandsDir).startsWith('..');

/**
 * The commands folder is missing. For a person running a project: create it, or point `commandsDir`
 * at a parent's (unless it already points outside). For a published tool the end user cannot fix
 * anything, so the hint is for its author, and never suggests running another package's commands.
 */
const missingCommandsError = (commandsDir: string, projectRoot: string, route: CliRoute) => {
    const manifestPath = path.join(projectRoot, MANIFEST_FILE);
    const create = `Create ${commandsDir}, or set "${CONFIG_KEY}": { "commandsDir" } in ${manifestPath}.`;

    const parent =
        ' If the commands live in a parent folder, point commandsDir at them, for example "../commands".';

    const author = ` If this is a published tool, its author has to ship the commands folder (add it to "files" in ${MANIFEST_FILE}).`;

    if (route === 'own') {
        return new CommandError(`Commands folder not found: ${commandsDir}`, {
            hint: create + author
        });
    }

    return new CommandError(`Commands folder not found: ${commandsDir}`, {
        hint: pointsOutside(commandsDir, projectRoot) ? create : create + parent
    });
};

/** The project of a folder and where its commands are, or a CommandError that says what to create. */
const settingsFor: SettingsForFn = (start, route) => {
    // The messages name no binary: it is not known here what the user typed (art, artemis or a tool's name).
    const project = findProject(start, readManifest, isFolder, route);

    if (!project) {
        throw noProjectError(start, route);
    }

    const settings = resolveSettings(project, route);

    if (!isFolder(settings.commandsDir)) {
        throw missingCommandsError(settings.commandsDir, project.root, route);
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
    const { leading, rest } = splitLeadingFlags(argv);

    // `init` is the shipped binary's own word, like `help`: it has to work where there is no project yet.
    if (route === 'shipped' && rest[0] === INIT_WORD) {
        try {
            return initCommand(
                [...leading, ...rest.slice(1)],
                host,
                path.resolve(cwd ?? workingDirectory())
            );
        } catch (error) {
            return reportSetupFailure(argv, error, host);
        }
    }

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
