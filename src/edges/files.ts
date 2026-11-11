import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ERROR_CODE, MANIFEST_FILE } from '../constants.js';
import { CommandError } from '../errors/errors.js';
import { messageOf } from '../utils/error-message.js';
import { isRecord } from '../utils/is-record.js';
import { codeOf } from '../utils/error-code.js';

import type {
    CreateExclusiveFn,
    IsFolderFn,
    ListDirectoryFn,
    MakeDirectoryFn,
    ModifiedAtFn,
    PathExistsFn,
    ReadManifestFn,
    ReadTextIfExistsFn,
    RealPathFn,
    RemoveFileFn,
    WriteTextFn
} from '../models.js';

// Edge: the only place the framework and the terminal kit touch the filesystem.

export const listDirectory: ListDirectoryFn = (dir) =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));

export const pathExists: PathExistsFn = (path) => fs.existsSync(path);

export const makeDirectory: MakeDirectoryFn = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
};

export const writeText: WriteTextFn = (file, text) => {
    fs.writeFileSync(file, text);
};

/** Removing a file that is not there is not an error: the goal is that it is gone. */
export const removeFile: RemoveFileFn = (file) => {
    fs.rmSync(file, { force: true });
};

/** The text of a file, or undefined when it is not there (someone may remove it at any moment). */
export const readTextIfExists: ReadTextIfExistsFn = (file) => {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (error) {
        if (codeOf(error) === ERROR_CODE.MISSING) {
            return undefined;
        }

        throw error;
    }
};

/**
 * Creates the file with its whole content already in it, or says someone else has it. The text is
 * written to a staging file that is then hard-linked into place, so the file can never be seen
 * empty or half written, and the link fails if the file already exists.
 */
export const createExclusive: CreateExclusiveFn = (file, text) => {
    const staging = `${file}.${randomUUID()}.tmp`;

    fs.writeFileSync(staging, text);

    try {
        fs.linkSync(staging, file);

        return true;
    } catch (error) {
        if (codeOf(error) === ERROR_CODE.EXISTS) {
            return false;
        }

        throw error;
    } finally {
        fs.rmSync(staging, { force: true });
    }
};

export const modifiedAt: ModifiedAtFn = (file) =>
    fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs;

/** The real path of a folder; one that does not exist yet has none, so it is resolved as given. */
export const realPathOrResolve: RealPathFn = (folder) => {
    try {
        return fs.realpathSync(folder);
    } catch {
        // Nothing to lose: a folder that does not exist yet is used by its resolved path.
        return path.resolve(folder);
    }
};

/** The text of a package.json. One that cannot be read (permissions, a folder of that name) is an error naming the file. */
function readManifestText(file: string): string | undefined {
    try {
        return readTextIfExists(file);
    } catch (error) {
        throw new CommandError(`Cannot read ${file}: ${messageOf(error)}`, {
            hint: 'Check that it is a readable file, or run from a folder whose package.json is.'
        });
    }
}

/**
 * The package.json of a folder as an object, or undefined when the folder has none. One that is not
 * valid JSON, or not an object, is an error: the nearest package.json defines the project.
 */
export const readManifest: ReadManifestFn = (dir) => {
    const file = path.join(dir, MANIFEST_FILE);
    const text = readManifestText(file);

    if (text === undefined) {
        return undefined;
    }

    try {
        const parsed: unknown = JSON.parse(text);

        if (isRecord(parsed)) {
            return parsed;
        }
    } catch (error) {
        throw new CommandError(`${file} is not valid JSON: ${messageOf(error)}`, {
            hint: 'Fix the file, or run from a folder whose package.json is valid.'
        });
    }

    throw new CommandError(`${file} must contain a JSON object`, {
        hint: 'A package.json is an object, such as { "name": "my-project" }.'
    });
};

export const isFolder: IsFolderFn = (target) =>
    fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
