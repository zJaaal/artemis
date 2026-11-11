import path from 'node:path';

import {
    CONFIG_KEY,
    DEFAULT_BIN_NAME,
    DEFAULT_COMMANDS_FOLDER,
    MANIFEST_FILE
} from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type {
    ArtemisConfig,
    FindProjectFn,
    Project,
    ReadManifestFn,
    ResolveBinNameFn,
    ResolveSettingsFn
} from '../models.js';
import { isRecord } from '../utils/is-record.js';

const VALID_SHAPE_HINT = `The key looks like "${CONFIG_KEY}": { "commandsDir": "commands", "bin": "mytool" }, and both fields are optional.`;

function searchUpwards(dir: string, readManifest: ReadManifestFn): Project | undefined {
    const manifest = readManifest(dir);

    if (manifest) {
        return { root: dir, manifest };
    }

    const parent = path.dirname(dir);

    return parent === dir ? undefined : searchUpwards(parent, readManifest);
}

/**
 * The project is the folder of the nearest package.json, looking in `cwd` and then each parent. The
 * first one found wins, even without an "artemis" key (in a monorepo, the package you stand in).
 * Pure: files are read only through `readManifest`.
 */
export const findProject: FindProjectFn = (cwd, readManifest) =>
    searchUpwards(path.resolve(cwd), readManifest);

const isNonEmptyText = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;

function invalidConfig(project: Project, problem: string): CommandError {
    const manifestPath = path.join(project.root, MANIFEST_FILE);

    return new CommandError(`${problem} (in ${manifestPath})`, { hint: VALID_SHAPE_HINT });
}

/** The "artemis" key of the manifest, checked field by field. */
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

/** The name help and usage lines show: the config's, else the single `bin` of the project, else "art". */
export const resolveBinName: ResolveBinNameFn = (manifest) => {
    const configured = isRecord(manifest[CONFIG_KEY]) ? manifest[CONFIG_KEY].bin : undefined;

    if (isNonEmptyText(configured)) {
        return configured;
    }

    const own = isRecord(manifest.bin) ? Object.keys(manifest.bin) : [];
    const [only] = own;

    return own.length === 1 && only !== undefined ? only : DEFAULT_BIN_NAME;
};

/** The settings of a project: where its commands are (absolute) and what to call the CLI. */
export const resolveSettings: ResolveSettingsFn = (project) => {
    const config = readConfig(project);

    return {
        bin: resolveBinName(project.manifest),
        commandsDir: path.resolve(project.root, config.commandsDir ?? DEFAULT_COMMANDS_FOLDER)
    };
};
