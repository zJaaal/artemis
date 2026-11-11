import fs from 'node:fs';

import type { ListDirectoryFn, PathExistsFn } from '../models.js';

// Edge: the only place discovery touches the filesystem.

export const listDirectory: ListDirectoryFn = (dir) =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));

export const pathExists: PathExistsFn = (path) => fs.existsSync(path);
