import fs from 'node:fs';
import path from 'node:path';

import { ERROR_CODE } from '../constants.js';
import { codeOf } from '../utils/error-code.js';

import type {
    CreateExclusiveFn,
    ListDirectoryFn,
    MakeDirectoryFn,
    PathExistsFn,
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

export const createExclusive: CreateExclusiveFn = (file, text) => {
    try {
        fs.writeFileSync(file, text, { flag: 'wx' });

        return true;
    } catch (error) {
        if (codeOf(error) === ERROR_CODE.EXISTS) {
            return false;
        }

        throw error;
    }
};

/** The real path of a folder; one that does not exist yet has none, so it is resolved as given. */
export const realPathOrResolve: RealPathFn = (folder) => {
    try {
        return fs.realpathSync(folder);
    } catch {
        // Nothing to lose: a folder that does not exist yet is used by its resolved path.
        return path.resolve(folder);
    }
};
