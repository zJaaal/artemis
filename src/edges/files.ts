import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ERROR_CODE, JSON_EXTENSION, MANIFEST_FILE, TEMP_SUFFIX } from '../constants.js';
import { CommandError } from '../errors/errors.js';
import { messageOf } from '../utils/error-message.js';
import { isRecord } from '../utils/is-record.js';
import { codeOf } from '../utils/error-code.js';

import type {
    CreateExclusiveFn,
    IsFolderFn,
    ListDirectoryFn,
    ListJsonFilesFn,
    ManifestRead,
    MakeDirectoryFn,
    ModifiedAtFn,
    PathExistsFn,
    ReadManifestFn,
    ReadTextIfExistsFn,
    RealPathFn,
    RemoveFileFn,
    WriteAtomicFn,
    WriteTextFn
} from '../models.js';

// Edge: the only place the framework and the terminal kit touch the filesystem.

export const listDirectory: ListDirectoryFn = (dir) =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));

/** Whether a link leads to a file. One that cannot be followed for another reason than leading nowhere (a loop, no permission) is listed too, so `art state` can say why. */
function linkLeadsToFile(link: string): boolean {
    try {
        return fs.statSync(link).isFile();
    } catch (error) {
        return codeOf(error) !== ERROR_CODE.MISSING;
    }
}

/** A file, or a symbolic link to one: the store reads and writes through links, so a listing must see them. */
const isFileOrLinkToFile = (dir: string, entry: fs.Dirent): boolean =>
    entry.isFile() || (entry.isSymbolicLink() && linkLeadsToFile(path.join(dir, entry.name)));

/** Only `*.json` files count: `<doc>.json.lock` and `<doc>.json.<pid>.<token>.tmp` are never listed. */
export const listJsonFiles: ListJsonFilesFn = (dir) => {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter(
                (entry) => entry.name.endsWith(JSON_EXTENSION) && isFileOrLinkToFile(dir, entry)
            )
            .map((entry) => entry.name)
            .sort();
    } catch (error) {
        if (codeOf(error) === ERROR_CODE.MISSING) {
            return [];
        }

        throw error;
    }
};

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

/**
 * Writes the text next to the file and renames it into place, so a crash or a reader never sees
 * half a file. The temporary file is named after the process, and removed whatever happens.
 */
export const writeAtomic: WriteAtomicFn = (file, text) => {
    const staging = `${file}.${process.pid}.${randomUUID()}${TEMP_SUFFIX}`;

    try {
        fs.writeFileSync(staging, text);
        fs.renameSync(staging, file);
    } finally {
        fs.rmSync(staging, { force: true });
    }
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
    const staging = `${file}.${randomUUID()}${TEMP_SUFFIX}`;

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

/** A package.json that cannot be read: the file is named, and nothing is thrown. */
const unreadable = (file: string, error: unknown): ManifestRead => ({
    error: new CommandError(`Cannot read ${file}: ${messageOf(error)}`, {
        hint: 'Check that it is a readable file, or run from a folder whose package.json is.'
    })
});

function parseManifest(file: string, text: string): ManifestRead {
    try {
        const parsed: unknown = JSON.parse(text);

        if (isRecord(parsed)) {
            return { manifest: parsed, text };
        }
    } catch (error) {
        return {
            error: new CommandError(`${file} is not valid JSON: ${messageOf(error)}`, {
                hint: 'Fix the file, or run from a folder whose package.json is valid.'
            })
        };
    }

    return {
        error: new CommandError(`${file} must contain a JSON object`, {
            hint: 'A package.json is an object, such as { "name": "my-project" }.'
        })
    };
}

/**
 * What the package.json of a folder says, or undefined when the folder has none. A file that cannot
 * be read, is not valid JSON or is not an object is returned as an error, not thrown: whether it
 * matters depends on whether it turns out to be the project.
 */
export const readManifest: ReadManifestFn = (dir) => {
    const file = path.join(dir, MANIFEST_FILE);
    let text: string | undefined;

    try {
        text = readTextIfExists(file);
    } catch (error) {
        return unreadable(file, error);
    }

    return text === undefined ? undefined : parseManifest(file, text);
};

export const isFolder: IsFolderFn = (target) =>
    fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
