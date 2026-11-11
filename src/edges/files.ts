import fs from 'node:fs';

import type {
    ListDirectoryFn,
    MakeDirectoryFn,
    PathExistsFn,
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
