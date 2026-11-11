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

/** A package.json is the project when it has an "artemis" key or a commands folder beside it. */
const isProject = (dir: string, manifest: Record<string, unknown>, isFolder: IsFolderFn): boolean =>
    manifest[CONFIG_KEY] !== undefined || isFolder(path.join(dir, DEFAULT_COMMANDS_FOLDER));

function searchUpwards(
    dir: string,
    readManifest: ReadManifestFn,
    isFolder: IsFolderFn
): Project | undefined {
    const manifest = readManifest(dir);

    if (manifest && isProject(dir, manifest, isFolder)) {
        return { root: dir, manifest };
    }

    const parent = path.dirname(dir);

    return parent === dir ? undefined : searchUpwards(parent, readManifest, isFolder);
}

/**
 * The project is the folder of the nearest package.json that has an "artemis" key or a commands
 * folder next to it, looking in `cwd` and then each parent. A package.json that is neither, such as a
 * `{ "type": "module" }` marker in `src/` or `dist/`, or a monorepo package without commands, is
 * skipped and the search goes on upwards. Pure: the disk is only looked at through the two edges.
 */
export const findProject: FindProjectFn = (cwd, readManifest, isFolder) =>
    searchUpwards(path.resolve(cwd), readManifest, isFolder);

const isNonEmptyText = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;

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

/** The command npm creates for the `bin` field of a package: its single key, or the package name. */
function ownBinName(manifest: Record<string, unknown>): string | undefined {
    const { bin, name } = manifest;

    if (isRecord(bin)) {
        const keys = Object.keys(bin);
        const [only] = keys;

        return keys.length === 1 ? only : undefined;
    }

    return isNonEmptyText(bin) && isNonEmptyText(name) ? name.replace(SCOPE_PREFIX, '') : undefined;
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
