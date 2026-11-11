import path from 'node:path';

import { JSON_EXTENSION } from '../../constants.js';
import { MEMORY_DIR, STORE_INDENT_SPACES } from './constants.js';
import { createHeldLocks } from './held.js';
import { alreadyHeldError } from './lock.js';
import type { CreateMemoryStoreFn, DocBackend } from './models.js';
import { assembleStore } from './store.js';

/** The queue only needs to know a call ended; whoever made the call gets its error. */
const noop = (): void => undefined;

/** Documents as JSON text in a map, so copies and corrupt text behave as they do on disk. */
function memoryBackend(texts: Map<string, string>): DocBackend {
    return {
        readText: (file) => texts.get(file),
        writeText: (file, text) => {
            texts.set(file, text);
        },
        reset: (file) => {
            texts.delete(file);
        },
        // Synchronous work cannot interleave inside one process, so there is nothing to exclude.
        withLock: (_file, work) => work()
    };
}

/**
 * A store with the same API as `defineStore` that never touches the disk: for tests of commands
 * that keep state. `documents` holds what is "on disk" at the start, by name; a versioned
 * document is given wrapped, as its file would be.
 */
export const createMemoryStore: CreateMemoryStoreFn = ({ documents = {} } = {}) => {
    const texts = new Map(
        Object.entries(documents).map(([name, value]) => [
            path.join(MEMORY_DIR, `${name}${JSON_EXTENSION}`),
            `${JSON.stringify(value, null, STORE_INDENT_SPACES)}\n`
        ])
    );

    const held = createHeldLocks();
    const queues = new Map<string, Promise<unknown>>();

    return assembleStore(MEMORY_DIR, memoryBackend(texts), async (name, work) => {
        if (held.isHeldHere(name)) {
            throw alreadyHeldError(name);
        }

        // Concurrent callers of one name run one after the other, as they do through a lock file.
        const run = (queues.get(name) ?? Promise.resolve()).then(() => held.holding(name, work));
        const settled = run.then(noop, noop);

        queues.set(name, settled);

        try {
            return await run;
        } finally {
            if (queues.get(name) === settled) {
                queues.delete(name);
            }
        }
    });
};
