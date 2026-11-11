import { CommandError } from '../../errors/errors.js';
import { isThenable } from '../../utils/is-thenable.js';
import {
    CORRUPT_DOCUMENT_HINT,
    STORE_INDENT_SPACES,
    SYNC_ONLY_ADVICE,
    UNVERSIONED
} from './constants.js';
import type { CreateDocumentFn, Doc } from './models.js';
import { parseDocumentText } from './raw.js';
import { unwrapVersion, upgradeValue, wrapVersion } from './versions.js';

/** A promise that is dropped must not crash the process later: its caller already has the TypeError. */
const ignoreAbandonedWork = (): void => undefined;

/** Document work runs inside the lock and must finish before it is released: a promise would escape. */
function assertSynchronous(result: unknown, what: string): void {
    if (isThenable(result)) {
        Promise.resolve(result).catch(ignoreAbandonedWork);

        throw new TypeError(`${what} ${SYNC_ONLY_ADVICE}`);
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
        update: (change) =>
            backend.withLock(file, () => {
                const next = change(read());

                assertSynchronous(next, 'update() change');

                if (next === undefined) {
                    throw new TypeError('update() must return the new value');
                }

                write(next);

                return next;
            }),
        locked: (work) =>
            backend.withLock(file, () => {
                const result = work(doc);

                assertSynchronous(result, 'locked() work');

                return result;
            }),
        reset: () => backend.reset(file)
    };

    return doc;
};
