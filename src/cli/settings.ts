import path from 'node:path';

import {
    AUDIT_CONFIG_KEY,
    AUDIT_FILE_NAME,
    CONFIG_KEY,
    DEFAULT_BIN_NAME,
    DEFAULT_COMMANDS_FOLDER,
    DEFAULT_STATE_FOLDER,
    MANIFEST_FILE,
    NODE_MODULES,
    SCOPE_FOLDER_PREFIX,
    SCOPE_PREFIX
} from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type {
    ArtemisConfig,
    FindProjectFn,
    CliRoute,
    IsFolderFn,
    IsInstalledPackageRootFn,
    NoProjectErrorFn,
    Project,
    ReadManifestFn,
    ResolveAuditFileFn,
    ResolveBinNameFn,
    ResolveSettingsFn,
    ResolveStateDirFn
} from '../models.js';
import { isRecord } from '../utils/is-record.js';
import { INIT_WORD } from './constants.js';

const VALID_SHAPE_HINT = `The key looks like "${CONFIG_KEY}": { "commandsDir": "commands", "bin": "mytool", "stateDir": "state", "audit": false }, and every field is optional.`;

const isNonEmptyText = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;

/**
 * Shipped route: a package.json is the project when it declares itself, with an "artemis" key (what
 * `init` writes), or follows the convention, with a commands folder next to it.
 */
const isProjectOfAPerson = (
    dir: string,
    manifest: Record<string, unknown>,
    isFolder: IsFolderFn
): boolean =>
    manifest[CONFIG_KEY] !== undefined || isFolder(path.join(dir, DEFAULT_COMMANDS_FOLDER));

/** Whether a package.json declares a `bin`: a string, or an object with at least one command. */
const declaresBin = ({ bin }: Record<string, unknown>): boolean =>
    isRecord(bin) ? Object.keys(bin).length > 0 : isNonEmptyText(bin);

/**
 * Own route: a package.json says what a tool's package is when it has a name, declares a `bin`, or has
 * an "artemis" key. The package.json files above a bin file are a marker or two in its own folders
 * (no name, no bin, no key), then the tool's package, then the project that holds it, so the first of
 * these is the tool's own, whether or not it declares a `bin`.
 */
const hasToolIdentity = (manifest: Record<string, unknown>): boolean =>
    isNonEmptyText(manifest.name) || declaresBin(manifest) || manifest[CONFIG_KEY] !== undefined;

/** Whether a folder is the folder of a package installed by npm: `node_modules/pkg` or `node_modules/@scope/pkg`. */
const isInstalledPackageRoot: IsInstalledPackageRootFn = (dir) => {
    const parent = path.dirname(dir);

    const container = path.basename(parent).startsWith(SCOPE_FOLDER_PREFIX)
        ? path.dirname(parent)
        : parent;

    return path.basename(container) === NODE_MODULES;
};

const isTheProject = (
    dir: string,
    manifest: Record<string, unknown>,
    isFolder: IsFolderFn,
    route: CliRoute
): boolean =>
    route === 'own' ? hasToolIdentity(manifest) : isProjectOfAPerson(dir, manifest, isFolder);

function searchUpwards(
    dir: string,
    readManifest: ReadManifestFn,
    isFolder: IsFolderFn,
    route: CliRoute
): Project | undefined {
    const read = readManifest(dir);

    // Failing loudly beats silently running the commands of a different project.
    if (read && 'error' in read) {
        throw read.error;
    }

    if (read && isTheProject(dir, read.manifest, isFolder, route)) {
        return { root: dir, manifest: read.manifest };
    }

    // A tool installed by npm is its own package whatever its package.json holds: never look past it.
    if (route === 'own' && isInstalledPackageRoot(dir)) {
        return read ? { root: dir, manifest: read.manifest } : undefined;
    }

    const parent = path.dirname(dir);

    return parent === dir ? undefined : searchUpwards(parent, readManifest, isFolder, route);
}

/**
 * The project of a folder, looking in `start` and then each parent. Shipped route: the nearest
 * package.json with an "artemis" key or a commands folder next to it. Own route (`cli({ root })`):
 * the nearest one with the identity of a package (a name, a `bin` or an "artemis" key), and never
 * past the folder of an installed package, so a tool cannot climb into the project that holds it,
 * with or without a `bin`. A package.json that cannot be read or parsed is an error, never skipped.
 * Pure: the disk is only looked at through the two edges.
 */
export const findProject: FindProjectFn = (start, readManifest, isFolder, route) =>
    searchUpwards(path.resolve(start), readManifest, isFolder, route);

function invalidConfig(project: Project, problem: string): CommandError {
    const manifestPath = path.join(project.root, MANIFEST_FILE);

    return new CommandError(`${problem} (in ${manifestPath})`, { hint: VALID_SHAPE_HINT });
}

/** The "artemis" key of the manifest, checked field by field. It is only read here. */
function readConfig(project: Project): ArtemisConfig {
    const declared = project.manifest[CONFIG_KEY];

    if (declared === undefined) {
        return {};
    }

    if (!isRecord(declared)) {
        throw invalidConfig(project, `"${CONFIG_KEY}" must be an object`);
    }

    for (const field of ['commandsDir', 'bin', 'stateDir']) {
        if (declared[field] !== undefined && !isNonEmptyText(declared[field])) {
            throw invalidConfig(project, `"${CONFIG_KEY}".${field} must be a non-empty string`);
        }
    }

    if (
        declared[AUDIT_CONFIG_KEY] !== undefined &&
        typeof declared[AUDIT_CONFIG_KEY] !== 'boolean'
    ) {
        throw invalidConfig(project, `"${CONFIG_KEY}".${AUDIT_CONFIG_KEY} must be true or false`);
    }

    return declared;
}

/**
 * The command a project's own bin file is known by: the single key of its `bin` object. When `bin`
 * does not name one command (a string, or several keys) npm names it after the package, so that is
 * the name, without its `@scope/`. A project with no `bin` at all has no name of its own.
 */
function ownBinName(manifest: Record<string, unknown>): string | undefined {
    const { bin, name } = manifest;
    const keys = isRecord(bin) ? Object.keys(bin) : [];
    const [only] = keys;

    if (keys.length === 1) {
        return only;
    }

    const namesNoSingleCommand = keys.length > 1 || isNonEmptyText(bin);

    return namesNoSingleCommand && isNonEmptyText(name)
        ? name.replace(SCOPE_PREFIX, '')
        : undefined;
}

/**
 * The name help and usage lines show. The shipped binary shows `"artemis".bin` or `art`, never the
 * name of an unrelated CLI the project publishes; a project's own bin file also uses the name of
 * its own `bin` field.
 */
export const resolveBinName: ResolveBinNameFn = (config, manifest, route) => {
    if (config.bin) {
        return config.bin;
    }

    return (route === 'own' ? ownBinName(manifest) : undefined) ?? DEFAULT_BIN_NAME;
};

/** The settings of a project: where its commands are (absolute) and what to call the CLI. */
export const resolveSettings: ResolveSettingsFn = (project, route) => {
    const config = readConfig(project);

    return {
        bin: resolveBinName(config, project.manifest, route),
        commandsDir: path.resolve(project.root, config.commandsDir ?? DEFAULT_COMMANDS_FOLDER)
    };
};

/**
 * Where the store kit keeps its documents: `"artemis".stateDir` (default `state`), resolved from the
 * project root, never from the current folder. `art state` and `defineStore({ project })` both
 * come here, so the CLI and the app cannot disagree about the folder.
 */
export const resolveStateDir: ResolveStateDirFn = (project) =>
    path.resolve(project.root, readConfig(project).stateDir ?? DEFAULT_STATE_FOLDER);

/** What to do when no project is found: the end user can create one, the author of a tool must declare its bin. */
export const noProjectError: NoProjectErrorFn = (start, route) =>
    route === 'own'
        ? new CommandError(`No ${MANIFEST_FILE} with a "bin" field found from ${start} upwards`, {
              hint: `A published tool is found through the ${MANIFEST_FILE} that declares its "bin" (npm needs it to create the command anyway). If you maintain this tool, declare "bin" there and ship a ${DEFAULT_COMMANDS_FOLDER}/ folder in the package (see "files" in ${MANIFEST_FILE}).`
          })
        : new CommandError(`No project found from ${start} upwards`, {
              hint: `A project is the nearest ${MANIFEST_FILE} with an "${CONFIG_KEY}" key or a ${DEFAULT_COMMANDS_FOLDER}/ folder next to it. Run it inside one, or use its "${INIT_WORD}" command in this folder to create one.`
          });

/**
 * Where the audit trail is written (absolute): `audit.jsonl` in the state folder, or nothing when the
 * project turned it off with `"audit": false`. Throws a CommandError when the "artemis" key has a bad shape.
 */
export const resolveAuditFile: ResolveAuditFileFn = (project) =>
    readConfig(project)[AUDIT_CONFIG_KEY] === false
        ? undefined
        : path.join(resolveStateDir(project), AUDIT_FILE_NAME);
