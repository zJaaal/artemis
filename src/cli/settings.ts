import path from 'node:path';

import {
    CONFIG_KEY,
    DEFAULT_BIN_NAME,
    DEFAULT_COMMANDS_FOLDER,
    MANIFEST_FILE,
    SCOPE_PREFIX
} from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type {
    ArtemisConfig,
    FindProjectFn,
    IsFolderFn,
    Project,
    ReadManifestFn,
    ResolveBinNameFn,
    ResolveSettingsFn
} from '../models.js';
import { isRecord } from '../utils/is-record.js';

const VALID_SHAPE_HINT = `The key looks like "${CONFIG_KEY}": { "commandsDir": "commands", "bin": "mytool" }, and both fields are optional.`;

const isNonEmptyText = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;

/**
 * A marker is a package.json that says nothing but "type" and has no commands folder next to it: the
 * kind of file put in `src/` or `dist/` only to set how `.js` files are read. Anything else is a
 * package: it has a name, a version, an "artemis" key, or just a commands folder beside it.
 */
const isMarker = (dir: string, manifest: Record<string, unknown>, isFolder: IsFolderFn): boolean =>
    Object.keys(manifest).every((key) => key === 'type') &&
    !isFolder(path.join(dir, DEFAULT_COMMANDS_FOLDER));

function searchUpwards(
    dir: string,
    readManifest: ReadManifestFn,
    isFolder: IsFolderFn
): Project | undefined {
    const read = readManifest(dir);

    // Failing loudly beats silently running the commands of a different project.
    if (read && 'error' in read) {
        throw read.error;
    }

    if (read && !isMarker(dir, read.manifest, isFolder)) {
        return { root: dir, manifest: read.manifest };
    }

    const parent = path.dirname(dir);

    return parent === dir ? undefined : searchUpwards(parent, readManifest, isFolder);
}

/**
 * The project of a folder: the nearest package.json that is not a marker, looking in `cwd` and then
 * each parent. A marker such as `{ "type": "module" }` in `src/` or `dist/` is skipped; a package.json
 * that cannot be read or parsed is an error. The same rule serves a tool's bin file: whatever the
 * tool's own package says (named or not, private or not), it is more than a marker, so the search
 * stops there and never climbs out of the tool into the project that installed it.
 * Pure: the disk is only looked at through the two edges.
 */
export const findProject: FindProjectFn = (cwd, readManifest, isFolder) =>
    searchUpwards(path.resolve(cwd), readManifest, isFolder);

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

    for (const field of ['commandsDir', 'bin']) {
        if (declared[field] !== undefined && !isNonEmptyText(declared[field])) {
            throw invalidConfig(project, `"${CONFIG_KEY}".${field} must be a non-empty string`);
        }
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
