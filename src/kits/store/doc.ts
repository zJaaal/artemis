import { CommandError } from '../../errors/errors.js';
import { isThenable } from '../../utils/is-thenable.js';
import {
    ABANDONED_WORK_ADVICE,
    CORRUPT_DOCUMENT_HINT,
    STORE_INDENT_SPACES,
    SYNC_ONLY_ADVICE,
    UNVERSIONED
} from './constants.js';
import type { CreateDocumentFn, Doc, WorkScope } from './models.js';
import { parseDocumentText } from './raw.js';
import { unwrapVersion, upgradeValue, wrapVersion } from './versions.js';
import { isAbandonedHere, runInWorkScope } from './work-scope.js';

/** A promise that is dropped must not crash the process later: its caller already has the TypeError. */
const ignoreAbandonedWork = (): void => undefined;

/**
 * Runs document work in a scope of its own. Work must finish before the lock is released, so a
 * promise is refused with a TypeError, and everything the abandoned work still starts (a write
 * after its first `await`, through this document or any other) is refused as well.
 */
function runSynchronously<TResult>(work: () => TResult, what: string): TResult {
    const scope: WorkScope = { abandoned: false };
    const result = runInWorkScope(scope, work);

    if (isThenable(result)) {
        scope.abandoned = true;
        Promise.resolve(result).catch(ignoreAbandonedWork);

        throw new TypeError(`${what} ${SYNC_ONLY_ADVICE}`);
    }

    return result;
}

/** A write from abandoned async work would land outside the lock it was refused for. */
function assertNotAbandoned(name: string, what: string): void {
    if (isAbandonedHere()) {
        throw new TypeError(`${name}: ${what} ${ABANDONED_WORK_ADVICE}`);
    }
}

/**
 * A document over any backend: read with upgrades in memory, write atomically under the lock, and
 * read-modify-write as one step. The fallback is copied on every read, so no caller can change it.
 */
export const createDocument: CreateDocumentFn = (backend, file, name, options) => {
    const { fallback, version = UNVERSIONED, upgrades = {} } = options;

    const read = () => {
        const text = backend.readText(file);

        if (text === undefined) {
            return structuredClone(fallback);
        }

        const result = parseDocumentText(file, text);

        if ('error' in result) {
            throw new CommandError(result.error, { hint: CORRUPT_DOCUMENT_HINT });
        }

        return upgradeValue(
            file,
            unwrapVersion(result.parsed),
            version,
            upgrades
        ) as typeof fallback;
    };

    const write = (value: typeof fallback) => {
        assertNotAbandoned(name, 'write()');

        const json = JSON.stringify(wrapVersion(value, version), null, STORE_INDENT_SPACES);

        if (json === undefined) {
            throw new TypeError(`${name}: write() needs a value that can be saved as JSON.`);
        }

        backend.withLock(file, () => backend.writeText(file, `${json}\n`));
    };

    const doc: Doc<typeof fallback> = {
        name,
        file,
        read,
        write,
        update: (change) => {
            assertNotAbandoned(name, 'update()');

            return backend.withLock(file, () => {
                const next = runSynchronously(() => change(read()), 'update() change');

                if (next === undefined) {
                    throw new TypeError('update() must return the new value');
                }

                write(next);

                return next;
            });
        },
        locked: (work) => {
            assertNotAbandoned(name, 'locked()');

            return backend.withLock(file, () => runSynchronously(() => work(doc), 'locked() work'));
        },
        reset: () => {
            assertNotAbandoned(name, 'reset()');
            backend.reset(file);
        }
    };

    return doc;
};
