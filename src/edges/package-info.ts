import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARTEMIS_PACKAGE, NODE_MODULES } from '../constants.js';
import type { FindLocalCopyFn, ReadRunningPackageFn } from '../models.js';
import { readManifest } from './files.js';

// Edge: which Artemis is running, and which one a project installed, read from package.json files.

/** The folder of the running package: two folders above this file (`dist/edges` or `src/edges`). */
const RUNNING_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const versionOf = (dir: string): string | undefined => {
    const read = readManifest(dir);
    const version = read && 'manifest' in read ? read.manifest.version : undefined;

    return typeof version === 'string' ? version : undefined;
};

/** The version and folder of the Artemis that is running. */
export const readRunningPackage: ReadRunningPackageFn = () => ({
    version: versionOf(RUNNING_ROOT),
    root: RUNNING_ROOT
});

/** The folders to look in, from `start` up to the root: each one's own `node_modules/@zjaaal/artemis`. */
function candidates(start: string): string[] {
    const found: string[] = [];
    let dir = path.resolve(start);
    let reachedTop = false;

    while (!reachedTop) {
        found.push(path.join(dir, NODE_MODULES, ...ARTEMIS_PACKAGE.split('/')));

        const parent = path.dirname(dir);

        reachedTop = parent === dir;
        dir = parent;
    }

    return found;
}

/** The copy of Artemis a project installed, found the way Node finds a package: each `node_modules` upwards. */
export const findLocalCopy: FindLocalCopyFn = (projectRoot) => {
    const root = candidates(projectRoot).find((dir) => versionOf(dir) !== undefined);
    const version = root === undefined ? undefined : versionOf(root);

    return root === undefined || version === undefined ? undefined : { version, root };
};
