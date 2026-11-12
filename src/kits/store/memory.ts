import path from 'node:path';

import { JSON_EXTENSION } from '../../constants.js';
import { LOCK_SUFFIX, MEMORY_DIR, NAMED_LOCK_POLL_MS, STORE_INDENT_SPACES } from './constants.js';
import { createHeldLocks } from './held.js';
import { resolveLockEdges } from './lock-options.js';
import { alreadyHeldError, lockedError } from './lock.js';
import type {
    CreateMemoryStoreFn,
    DocBackend,
    LockEdges,
    MemoryHolder,
    NamedLockOptions
} from './models.js';
import { assembleStore } from './store.js';

const doNothing = (): void => undefined;

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
 * Waits for the holder to let go. With a deadline it also wakes every `pollMs` (or sooner, when the
 * deadline is nearer), so a wait that has run out is noticed even if the holder never lets go.
 */
function waitFor(
    holder: MemoryHolder,
    edges: LockEdges,
    pollMs: number,
    deadline: number | undefined
): Promise<void> {
    if (deadline === undefined) {
        return holder.released;
    }

    const nap = Math.min(pollMs, Math.max(deadline - edges.now(), 0));

    // When the holder lets go first, the nap is cancelled: a timer left behind would keep the process alive.
    const napping = new AbortController();

    return Promise.race([holder.released, edges.sleep(nap, napping.signal)]).finally(() =>
        napping.abort()
    );
}

/** Named locks held inside one process, with the same options and errors as the lock files of the disk store. */
function memoryLocks(edges: LockEdges) {
    const holders = new Map<string, MemoryHolder>();
    const held = createHeldLocks();

    return async <TResult>(
        name: string,
        work: () => TResult | Promise<TResult>,
        { onWait, pollMs = NAMED_LOCK_POLL_MS, timeoutMs, label }: NamedLockOptions = {}
    ): Promise<TResult> => {
        if (held.isHeldHere(name)) {
            throw alreadyHeldError(name);
        }

        const deadline = timeoutMs === undefined ? undefined : edges.now() + timeoutMs;
        let announced = false;

        // An unrelated call in this process finds the name taken and waits behind it, like a call
        // from another process would.
        for (let holder = holders.get(name); holder; holder = holders.get(name)) {
            // At the deadline, not after it: a clock that only moves when a nap ends could otherwise nap for 0 ms forever.
            if (deadline !== undefined && edges.now() >= deadline) {
                const file = path.join(MEMORY_DIR, name);

                throw lockedError(file, `${file}${LOCK_SUFFIX}`, holder);
            }

            if (!announced) {
                announced = true;

                onWait?.({
                    pid: holder.pid,
                    ...(holder.label === undefined ? {} : { label: holder.label })
                });
            }

            await waitFor(holder, edges, pollMs, deadline);
        }

        let letGo = doNothing;

        const released = new Promise<void>((resolve) => {
            letGo = resolve;
        });

        holders.set(name, {
            pid: edges.pid,
            ...(label === undefined ? {} : { label }),
            released
        });

        try {
            return await held.holding(name, work);
        } finally {
            holders.delete(name);
            letGo();
        }
    };
}

/**
 * A store with the same API as `defineStore` that never touches the disk: for tests of commands
 * that keep state. `documents` holds what is "on disk" at the start, by name; a versioned
 * document is given wrapped, as its file would be. Named locks honor `onWait`, `pollMs` and
 * `timeoutMs`, and take `now` and `sleep` so a test of a wait or a timeout never really waits.
 */
export const createMemoryStore: CreateMemoryStoreFn = ({ documents = {}, ...clock } = {}) => {
    const texts = new Map(
        Object.entries(documents).map(([name, value]) => [
            path.join(MEMORY_DIR, `${name}${JSON_EXTENSION}`),
            `${JSON.stringify(value, null, STORE_INDENT_SPACES)}\n`
        ])
    );

    return assembleStore(MEMORY_DIR, memoryBackend(texts), memoryLocks(resolveLockEdges(clock)));
};
