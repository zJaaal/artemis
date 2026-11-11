import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { CommandError } from '../../errors/errors.js';
import { describeStoreContract } from '../../test/store-contract.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import {
    CORRUPT_DOCUMENT_HINT,
    LOCK_SUFFIX,
    LOCK_TIMEOUT_MS,
    STORE_INDENT_SPACES
} from './constants.js';
import { defineStore } from './store.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const FALLBACK = { count: 0 };

/** A store over a real folder, with these documents written the way they would be on disk. */
const createDiskStore = (documents: Record<string, unknown> = {}) => {
    const dir = folders.make('artemis-store-');

    Object.entries(documents).forEach(([name, value]) => {
        fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value));
    });

    return defineStore({ dir });
};

describeStoreContract('disk store', createDiskStore);

describe('defineStore: the folder', () => {
    test('the store folder is absolute', () => {
        expect(path.isAbsolute(defineStore({ dir: '.' }).dir)).toBe(true);
    });

    test('a relative folder is resolved from the current folder', () => {
        expect(defineStore({ dir: 'state' }).dir).toBe(path.resolve('state'));
    });

    test('a document is the file <dir>/<name>.json', () => {
        const dir = folders.make('artemis-store-');

        expect(defineStore({ dir }).doc('instances', { fallback: FALLBACK }).file).toBe(
            path.join(dir, 'instances.json')
        );
    });
});

describe('defineStore: what is on disk', () => {
    test('a write creates the folder when it does not exist yet', () => {
        const dir = path.join(folders.make('artemis-store-'), 'not', 'there');

        defineStore({ dir }).doc('steps', { fallback: FALLBACK }).write({ count: 1 });

        expect(fs.existsSync(path.join(dir, 'steps.json'))).toBe(true);
    });

    test('JSON is written with 4-space indentation and a trailing newline', () => {
        const dir = folders.make('artemis-store-');

        defineStore({ dir }).doc('steps', { fallback: FALLBACK }).write({ count: 1 });

        expect(fs.readFileSync(path.join(dir, 'steps.json'), 'utf8')).toBe(
            `${JSON.stringify({ count: 1 }, null, STORE_INDENT_SPACES)}\n`
        );
    });

    test('a version 0 document is plain JSON on disk', () => {
        const dir = folders.make('artemis-store-');

        defineStore({ dir }).doc('steps', { fallback: FALLBACK }).write({ count: 1 });

        expect(JSON.parse(fs.readFileSync(path.join(dir, 'steps.json'), 'utf8'))).toEqual({
            count: 1
        });
    });

    test('a version 2 document is written as { $version, data }', () => {
        const dir = folders.make('artemis-store-');
        const upgrades = { 1: (previous: unknown) => previous, 2: (previous: unknown) => previous };

        defineStore({ dir })
            .doc('steps', { fallback: FALLBACK, version: 2, upgrades })
            .write({ count: 1 });

        expect(JSON.parse(fs.readFileSync(path.join(dir, 'steps.json'), 'utf8'))).toEqual({
            $version: 2,
            data: { count: 1 }
        });
    });

    test('a write leaves no temporary file and no lock behind', () => {
        const dir = folders.make('artemis-store-');

        defineStore({ dir }).doc('steps', { fallback: FALLBACK }).write({ count: 1 });

        expect(fs.readdirSync(dir)).toEqual(['steps.json']);
    });

    test('a failed update leaves no lock behind', () => {
        const dir = folders.make('artemis-store-');
        const doc = defineStore({ dir }).doc('steps', { fallback: FALLBACK });

        thrownBy(() =>
            doc.update(() => {
                throw new Error('change failed');
            })
        );

        expect(fs.existsSync(`${doc.file}${LOCK_SUFFIX}`)).toBe(false);
    });

    test('the lock of a document is <file>.lock, held while the work runs', () => {
        const dir = folders.make('artemis-store-');
        const doc = defineStore({ dir }).doc('instances', { fallback: FALLBACK });

        expect(doc.locked(() => fs.existsSync(path.join(dir, 'instances.json.lock')))).toBe(true);
    });

    test('a named lock is <dir>/<name>.lock, held while the work runs', async () => {
        const dir = folders.make('artemis-store-');
        const store = defineStore({ dir });

        expect(await store.lock('build', () => fs.existsSync(path.join(dir, 'build.lock')))).toBe(
            true
        );
    });

    test('a document is read from a file a 0.1 process wrote, unchanged', () => {
        const dir = folders.make('artemis-store-');
        const written = { main: { slot: 1, root: '/w/main' } };

        fs.writeFileSync(path.join(dir, 'instances.json'), `${JSON.stringify(written, null, 4)}\n`);

        expect(defineStore({ dir }).doc('instances', { fallback: {} }).read()).toEqual(written);
    });

    test('a read does not change the file', () => {
        const dir = folders.make('artemis-store-');
        const file = path.join(dir, 'steps.json');
        const upgrades = { 1: (previous: unknown) => previous };

        fs.writeFileSync(file, '{"count":1}');
        defineStore({ dir }).doc('steps', { fallback: FALLBACK, version: 1, upgrades }).read();

        expect(fs.readFileSync(file, 'utf8')).toBe('{"count":1}');
    });
});

describe('defineStore: a corrupt document', () => {
    const corrupt = () => {
        const dir = folders.make('artemis-store-');
        const doc = defineStore({ dir }).doc('steps', { fallback: FALLBACK });

        fs.writeFileSync(doc.file, '{ not json');

        return doc;
    };

    test('is a CommandError', () => {
        expect(thrownBy(() => corrupt().read())).toBeInstanceOf(CommandError);
    });

    test('names the file and says it is not valid JSON', () => {
        const doc = corrupt();

        expect(thrownBy(() => doc.read())).toMatchObject({
            message: expect.stringMatching(new RegExp(`^${doc.file} is not valid JSON: `))
        });
    });

    test('has a hint that names no binary', () => {
        expect(thrownBy(() => corrupt().read())).toMatchObject({ hint: CORRUPT_DOCUMENT_HINT });
    });

    test('can be reset, and then reads the fallback', () => {
        const doc = corrupt();

        doc.reset();

        expect(doc.read()).toEqual(FALLBACK);
    });

    test('is not repaired by an update that fails to read it', () => {
        const doc = corrupt();

        thrownBy(() => doc.update((current) => current));

        expect(fs.readFileSync(doc.file, 'utf8')).toBe('{ not json');
    });
});

describe('defineStore: a write that fails', () => {
    test('leaves the document as it was and no temporary file', () => {
        const dir = folders.make('artemis-store-');
        const doc = defineStore({ dir }).doc('steps', { fallback: FALLBACK });

        fs.mkdirSync(doc.file);

        expect(thrownBy(() => doc.write({ count: 2 }))).toBeInstanceOf(Error);
        expect(fs.readdirSync(dir).sort()).toEqual(['steps.json']);
    });
});

describe('defineStore: lock options', () => {
    test('a document lock held by a live process makes a write give up after lockTimeoutMs', () => {
        const dir = folders.make('artemis-store-');
        const HOLDER_PID = 4242;
        const TIMEOUT_MS = 50;
        let clock = Date.now();

        const doc = defineStore({
            dir,
            now: () => clock,
            isProcessAlive: (pid) => pid === HOLDER_PID,
            pause: (ms) => {
                clock += ms;
            },
            lockTimeoutMs: TIMEOUT_MS
        }).doc('steps', { fallback: FALLBACK });

        fs.writeFileSync(`${doc.file}${LOCK_SUFFIX}`, `${HOLDER_PID} theirs`);

        expect(thrownBy(() => doc.write({ count: 1 }))).toMatchObject({
            message: `${doc.file} is locked by process ${HOLDER_PID}.`
        });
    });

    test('a reset gives up after lockTimeoutMs too, not after the default', () => {
        const dir = folders.make('artemis-store-');
        const HOLDER_PID = 4242;
        const TIMEOUT_MS = 50;
        const start = Date.now();
        let clock = start;

        const doc = defineStore({
            dir,
            now: () => clock,
            isProcessAlive: (pid) => pid === HOLDER_PID,
            pause: (ms) => {
                clock += ms;
            },
            lockTimeoutMs: TIMEOUT_MS
        }).doc('steps', { fallback: FALLBACK });

        fs.writeFileSync(`${doc.file}${LOCK_SUFFIX}`, `${HOLDER_PID} theirs`);
        thrownBy(() => doc.reset());

        expect(clock - start).toBeLessThan(LOCK_TIMEOUT_MS);
    });

    test('a named lock waits with the injected sleep, not the real one', async () => {
        const dir = folders.make('artemis-store-');
        const HOLDER_PID = 4242;
        const POLL_MS = 7;
        const slept: number[] = [];
        const lock = path.join(dir, `build${LOCK_SUFFIX}`);

        const store = defineStore({
            dir,
            isProcessAlive: (pid) => pid === HOLDER_PID,
            sleep: (ms) => {
                slept.push(ms);
                fs.rmSync(lock, { force: true });

                return Promise.resolve();
            }
        });

        fs.writeFileSync(lock, `${HOLDER_PID} theirs`);
        await store.lock('build', () => undefined, { pollMs: POLL_MS });

        expect(slept).toEqual([POLL_MS]);
    });
});

describe('defineStore: named locks held by other processes', () => {
    const HOLDER_PID = 4242;
    const DEAD_PID = 999_999;
    const TIMEOUT_MS = 100;
    const POLL_MS = 30;

    const lockedBy = (pid: number) => {
        const dir = folders.make('artemis-store-');
        const lock = path.join(dir, `build${LOCK_SUFFIX}`);

        fs.writeFileSync(lock, `${pid} theirs`);

        return { dir, lock };
    };

    test('a lock left by a process that died is taken over', async () => {
        const { dir } = lockedBy(DEAD_PID);
        const store = defineStore({ dir, isProcessAlive: (pid) => pid === HOLDER_PID });

        expect(await store.lock('build', () => 'took over')).toBe('took over');
    });

    test('onWait is told the pid of the holder, once, and the work runs after it lets go', async () => {
        const { dir, lock } = lockedBy(HOLDER_PID);
        const holders: unknown[] = [];

        const store = defineStore({
            dir,
            isProcessAlive: (pid) => pid === HOLDER_PID,
            sleep: () => {
                fs.rmSync(lock, { force: true });

                return Promise.resolve();
            }
        });

        await store.lock('build', () => undefined, { onWait: (holder) => holders.push(holder) });

        expect(holders).toEqual([{ pid: HOLDER_PID }]);
    });

    test('gives up after timeoutMs when the holder never lets go', async () => {
        const { dir } = lockedBy(HOLDER_PID);
        let clock = Date.now();

        const store = defineStore({
            dir,
            now: () => clock,
            isProcessAlive: (pid) => pid === HOLDER_PID,
            sleep: (ms) => {
                clock += ms;

                return Promise.resolve();
            }
        });

        await expect(
            store.lock('build', () => 'never', { timeoutMs: TIMEOUT_MS, pollMs: POLL_MS })
        ).rejects.toBeInstanceOf(CommandError);
    });
});
