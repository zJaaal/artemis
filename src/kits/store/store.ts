import path from 'node:path';

import { makeDirectory, readTextIfExists, writeAtomic } from '../../edges/files.js';
import { JSON_EXTENSION } from '../../constants.js';
import { createDocument } from './doc.js';
import { assertLockLabel } from './labels.js';
import { resolveLockEdges } from './lock-options.js';
import { withLockAsync, withLockSync } from './lock.js';
import { UNVERSIONED } from './constants.js';
import type { AssembleStoreFn, DefineStoreFn, DocBackend, LockEdges } from './models.js';
import { assertDocName } from './names.js';
import { resolveProjectDir } from './project.js';
import { removeDocument } from './raw.js';
import { assertUpgrades } from './versions.js';

/** Documents as files: written whole and renamed into place, under `<file>.lock`. */
function diskBackend(edges: LockEdges): DocBackend {
    return {
        readText: readTextIfExists,
        writeText: (file, text) => {
            makeDirectory(path.dirname(file));
            writeAtomic(file, text);
        },
        reset: (file) => removeDocument(file, edges),
        withLock: (file, work) => withLockSync(file, work, edges)
    };
}

/** A store over any backend: the same documents and named locks, wherever the text is kept. */
export const assembleStore: AssembleStoreFn = (dir, backend, lock) => ({
    dir,
    doc: (name, docOptions) => {
        assertDocName(name);
        assertUpgrades(name, docOptions.version ?? UNVERSIONED, docOptions.upgrades ?? {});

        return createDocument(
            backend,
            path.join(dir, `${name}${JSON_EXTENSION}`),
            name,
            docOptions
        );
    },
    lock: (name, work, lockOptions) => {
        assertDocName(name);

        if (lockOptions?.label !== undefined) {
            assertLockLabel(lockOptions.label);
        }

        return lock(name, work, lockOptions);
    }
});

/**
 * A store of named JSON documents in a folder the app chooses. The kit models nobody's state: the
 * app picks the names, the shapes and the defaults; the kit only guarantees how a file is read
 * and written (atomically, under a lock, with versions and one clear error for a corrupt file).
 */
export const defineStore: DefineStoreFn = (options) => {
    const dir = 'dir' in options ? path.resolve(options.dir) : resolveProjectDir(options.project);
    const edges = resolveLockEdges(options);

    return assembleStore(dir, diskBackend(edges), (name, work, lockOptions) =>
        withLockAsync(path.join(dir, name), work, edges, lockOptions)
    );
};
