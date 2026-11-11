import { describe, expect, test } from 'vitest';

import { CommandError } from '../errors/errors.js';
import type { LockHolder } from '../kits/store/models.js';
import type { CreateStoreFn } from './models.js';
import { thrownBy } from './thrown.js';

const FALLBACK = { count: 0, tags: ['a'] };
const OTHER_FALLBACK = { name: 'other' };

const upgradeToOne = (previous: unknown) => ({ ...(previous as object), one: true });
const upgradeToTwo = (previous: unknown) => ({ ...(previous as object), two: true });
const UPGRADES = { 1: upgradeToOne, 2: upgradeToTwo };

const VERSION_THREE_FILE = { $version: 3, data: { future: true } };
const WORK_MS = 5;
const POLL_MS = 2;
const BAD_NAMES = ['Steps', '../steps', 'a/b', 'steps.json', '', '-steps'];

type Counted = typeof FALLBACK;

/** What an app in plain JavaScript can pass: an async change, which the types do not allow. */
const asChange = (
    change: (current: Counted) => Promise<Counted>
): ((current: Counted) => Counted) => change as unknown as (current: Counted) => Counted;

/** Work that holds a lock until the test opens the door. */
const createDoor = () => {
    let open: () => void = () => undefined;

    const closed = new Promise<void>((resolve) => {
        open = resolve;
    });

    return { closed, open: () => open() };
};

const sleepFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The behavior every store must have, run against each: the same cases for the disk store and the
 * memory store, so a command tested on one behaves the same on the other.
 */
export const describeStoreContract = (label: string, create: CreateStoreFn): void => {
    describe(`${label}: documents`, () => {
        test('a document knows its name and its file', () => {
            const doc = create().doc('instances', { fallback: FALLBACK });

            expect([doc.name, doc.file.endsWith('instances.json')]).toEqual(['instances', true]);
        });

        test.each(BAD_NAMES.map((name) => ({ name })))(
            'the name "$name" is a TypeError',
            ({ name }) => {
                expect(thrownBy(() => create().doc(name, { fallback: FALLBACK }))).toBeInstanceOf(
                    TypeError
                );
            }
        );

        test('reading a document that does not exist gives the fallback', () => {
            expect(create().doc('steps', { fallback: FALLBACK }).read()).toEqual(FALLBACK);
        });

        test('the fallback read is never the fallback object itself', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            expect(doc.read()).not.toBe(FALLBACK);
        });

        test('changing what a read of a missing document returned does not change the next read', () => {
            const doc = create().doc('steps', { fallback: { tags: ['a'] } });

            doc.read().tags.push('changed');

            expect(doc.read()).toEqual({ tags: ['a'] });
        });

        test('changing what a read returned does not change the next read', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.write({ count: 1, tags: ['x'] });
            doc.read().tags.push('changed');

            expect(doc.read()).toEqual({ count: 1, tags: ['x'] });
        });

        test('what was written is read back', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.write({ count: 5, tags: [] });

            expect(doc.read()).toEqual({ count: 5, tags: [] });
        });

        test('a second write replaces the first', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.write({ count: 5, tags: ['long', 'list', 'of', 'tags'] });
            doc.write({ count: 6, tags: [] });

            expect(doc.read()).toEqual({ count: 6, tags: [] });
        });

        test('a document that exists is read, not its fallback', () => {
            const doc = create({ steps: { count: 9, tags: ['seeded'] } }).doc('steps', {
                fallback: FALLBACK
            });

            expect(doc.read()).toEqual({ count: 9, tags: ['seeded'] });
        });

        test('documents are independent of each other', () => {
            const store = create();
            const steps = store.doc('steps', { fallback: FALLBACK });
            const other = store.doc('other', { fallback: OTHER_FALLBACK });

            steps.write({ count: 1, tags: [] });

            expect(other.read()).toEqual(OTHER_FALLBACK);
        });

        test("two handles on the same document see each other's writes", () => {
            const store = create();

            store.doc('steps', { fallback: FALLBACK }).write({ count: 3, tags: [] });

            expect(store.doc('steps', { fallback: FALLBACK }).read()).toEqual({
                count: 3,
                tags: []
            });
        });

        test('writing something that is not JSON is a TypeError', () => {
            const doc = create().doc<unknown>('steps', { fallback: null });

            expect(thrownBy(() => doc.write(undefined))).toBeInstanceOf(TypeError);
        });
    });

    describe(`${label}: update`, () => {
        test('returns what it wrote', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            expect(doc.update((current) => ({ ...current, count: current.count + 1 }))).toEqual({
                count: 1,
                tags: ['a']
            });
        });

        test('writes what the change returned', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.update((current) => ({ ...current, count: current.count + 1 }));

            expect(doc.read().count).toBe(1);
        });

        test('the change receives the current value', () => {
            const doc = create({ steps: { count: 41, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            expect(doc.update((current) => ({ ...current, count: current.count + 1 })).count).toBe(
                42
            );
        });

        test('a change that returns undefined is a TypeError', () => {
            const doc = create().doc<{ count: number } | undefined>('steps', {
                fallback: { count: 0 }
            });

            expect(thrownBy(() => doc.update(() => undefined))).toMatchObject({
                name: 'TypeError',
                message: 'update() must return the new value'
            });
        });

        test('a change that returns undefined writes nothing', () => {
            const doc = create().doc<{ count: number } | undefined>('steps', {
                fallback: { count: 0 }
            });

            thrownBy(() => doc.update(() => undefined));

            expect(doc.read()).toEqual({ count: 0 });
        });

        test('a change that throws writes nothing', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            thrownBy(() =>
                doc.update(() => {
                    throw new Error('change failed');
                })
            );

            expect(doc.read()).toEqual(FALLBACK);
        });

        test('an async change is a TypeError that points at store.lock', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            const asyncChange = (current: typeof FALLBACK) =>
                Promise.resolve(current) as unknown as typeof FALLBACK;

            expect(thrownBy(() => doc.update(asyncChange))).toMatchObject({
                name: 'TypeError',
                message: expect.stringContaining('store.lock')
            });
        });

        test('an async change writes nothing', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            const asyncChange = (current: typeof FALLBACK) =>
                Promise.resolve({ ...current, count: 99 }) as unknown as typeof FALLBACK;

            thrownBy(() => doc.update(asyncChange));

            expect(doc.read()).toEqual(FALLBACK);
        });

        test('an async change that writes through the doc after the update was refused changed nothing', async () => {
            const doc = create({ steps: { count: 2, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            thrownBy(() =>
                doc.update(
                    asChange(async (current) => {
                        await null;
                        doc.write({ count: 9, tags: [] });

                        return current;
                    })
                )
            );

            await sleepFor(WORK_MS);

            expect(doc.read()).toEqual({ count: 2, tags: [] });
        });

        test('an async change that updates through the doc after the update was refused changed nothing', async () => {
            const doc = create({ steps: { count: 2, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            thrownBy(() =>
                doc.update(
                    asChange(async (current) => {
                        await null;
                        doc.update(() => ({ count: 9, tags: [] }));

                        return current;
                    })
                )
            );

            await sleepFor(WORK_MS);

            expect(doc.read()).toEqual({ count: 2, tags: [] });
        });

        test('an update right after a refused async change does not wait for a lock', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            const asyncChange = (current: typeof FALLBACK) =>
                Promise.resolve(current) as unknown as typeof FALLBACK;

            thrownBy(() => doc.update(asyncChange));

            expect(doc.update((current) => ({ ...current, count: 7 })).count).toBe(7);
        });

        test('write inside update completes instead of waiting for its own lock', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.update((current) => {
                doc.write({ count: 10, tags: [] });

                return { ...current, count: 11 };
            });

            expect(doc.read().count).toBe(11);
        });

        test('update inside update completes too', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.update((current) => {
                doc.update((inner) => ({ ...inner, count: 5 }));

                return { ...current, count: 6 };
            });

            expect(doc.read().count).toBe(6);
        });
    });

    describe(`${label}: locked`, () => {
        test('returns what the work returned', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            expect(doc.locked(() => 'done')).toBe('done');
        });

        test('the work gets the document, which it can read and write', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.locked((held) => held.write({ count: held.read().count + 3, tags: [] }));

            expect(doc.read().count).toBe(3);
        });

        test('work that writes nothing leaves the document as it was', () => {
            const doc = create({ steps: { count: 2, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            doc.locked((held) => held.read());

            expect(doc.read()).toEqual({ count: 2, tags: [] });
        });

        test('async work is a TypeError that points at store.lock', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            expect(thrownBy(() => doc.locked(() => Promise.resolve('later')))).toMatchObject({
                name: 'TypeError',
                message: expect.stringContaining('store.lock')
            });
        });

        test('async work leaves the lock released', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            thrownBy(() => doc.locked(() => Promise.resolve('later')));

            expect(doc.update((current) => ({ ...current, count: 1 })).count).toBe(1);
        });

        test('async work that writes after the lock was released is refused with a TypeError', async () => {
            const doc = create().doc('steps', { fallback: FALLBACK });
            let late: Promise<void> = Promise.resolve();

            thrownBy(() =>
                doc.locked((held) => {
                    late = (async () => {
                        await null;
                        held.write({ count: 9, tags: [] });
                    })();

                    return late;
                })
            );

            await expect(late).rejects.toBeInstanceOf(TypeError);
        });

        test('async work that wrote after the lock was released changed nothing', async () => {
            const doc = create({ steps: { count: 2, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            thrownBy(() =>
                doc.locked((held) =>
                    (async () => {
                        await null;
                        held.write({ count: 9, tags: [] });
                    })()
                )
            );

            await new Promise((resolve) => setTimeout(resolve, WORK_MS));

            expect(doc.read()).toEqual({ count: 2, tags: [] });
        });

        test('async work that resets after the lock was released is refused too', async () => {
            const doc = create({ steps: { count: 2, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            thrownBy(() =>
                doc.locked((held) =>
                    (async () => {
                        await null;
                        held.reset();
                    })()
                )
            );

            await new Promise((resolve) => setTimeout(resolve, WORK_MS));

            expect(doc.read()).toEqual({ count: 2, tags: [] });
        });

        test('async work that writes through the outer doc after the lock was released changed nothing', async () => {
            const doc = create({ steps: { count: 2, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            thrownBy(() =>
                doc.locked(() =>
                    (async () => {
                        await null;
                        doc.write({ count: 9, tags: [] });
                    })()
                )
            );

            await sleepFor(WORK_MS);

            expect(doc.read()).toEqual({ count: 2, tags: [] });
        });

        test('async work that writes through another doc of the store after the lock was released changed nothing', async () => {
            const store = create({ other: { name: 'kept' } });
            const doc = store.doc('steps', { fallback: FALLBACK });
            const other = store.doc('other', { fallback: OTHER_FALLBACK });

            thrownBy(() =>
                doc.locked(() =>
                    (async () => {
                        await null;
                        other.write({ name: 'overwritten' });
                    })()
                )
            );

            await sleepFor(WORK_MS);

            expect(other.read()).toEqual({ name: 'kept' });
        });

        test('async work that writes through the outer doc is refused with a TypeError that names store.lock', async () => {
            const doc = create().doc('steps', { fallback: FALLBACK });
            let late: Promise<void> = Promise.resolve();

            thrownBy(() =>
                doc.locked(() => {
                    late = (async () => {
                        await null;
                        doc.write({ count: 9, tags: [] });
                    })();

                    return late;
                })
            );

            await expect(late).rejects.toMatchObject({
                name: 'TypeError',
                message: expect.stringContaining('store.lock')
            });
        });

        test('a write made before the first await of async work happened inside the lock and stays', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            thrownBy(() =>
                doc.locked(async () => {
                    doc.write({ count: 5, tags: [] });
                    await null;
                })
            );

            expect(doc.read()).toEqual({ count: 5, tags: [] });
        });

        test('a callback scheduled by work that finished normally can still write', async () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.locked(() => {
                setTimeout(() => doc.write({ count: 7, tags: [] }), 0);
            });

            await sleepFor(WORK_MS);

            expect(doc.read()).toEqual({ count: 7, tags: [] });
        });

        test('a write from a flow that never was inside the refused work is allowed', async () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            thrownBy(() => doc.locked(() => Promise.resolve('later')));
            await sleepFor(WORK_MS);
            doc.write({ count: 6, tags: [] });

            expect(doc.read()).toEqual({ count: 6, tags: [] });
        });

        test('the handle still writes while the lock is held', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.locked((held) => held.write({ count: 4, tags: [] }));

            expect(doc.read()).toEqual({ count: 4, tags: [] });
        });

        test('the handle can still read after the lock was released', () => {
            const doc = create({ steps: { count: 2, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            const kept = doc.locked((held) => held);

            expect(kept.read()).toEqual({ count: 2, tags: [] });
        });
    });

    describe(`${label}: reset`, () => {
        test('the next read returns the fallback', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            doc.write({ count: 8, tags: [] });
            doc.reset();

            expect(doc.read()).toEqual(FALLBACK);
        });

        test('resetting a document that does not exist is not an error', () => {
            const doc = create().doc('steps', { fallback: FALLBACK });

            expect(thrownBy(() => doc.reset())).toBeUndefined();
        });

        test('resets a document that is newer than the code', () => {
            const doc = create({ steps: VERSION_THREE_FILE }).doc('steps', {
                fallback: FALLBACK,
                version: 2,
                upgrades: UPGRADES
            });

            doc.reset();

            expect(doc.read()).toEqual(FALLBACK);
        });

        test('leaves the other documents alone', () => {
            const store = create({ other: { name: 'kept' } });

            store.doc('steps', { fallback: FALLBACK }).reset();

            expect(store.doc('other', { fallback: OTHER_FALLBACK }).read()).toEqual({
                name: 'kept'
            });
        });
    });

    describe(`${label}: versions`, () => {
        test('a version 0 document reads plain JSON', () => {
            const doc = create({ steps: { count: 4, tags: [] } }).doc('steps', {
                fallback: FALLBACK
            });

            expect(doc.read()).toEqual({ count: 4, tags: [] });
        });

        test('a version 2 document reads a plain file through both upgrades, in order', () => {
            const doc = create({ steps: { count: 4 } }).doc('steps', {
                fallback: {},
                version: 2,
                upgrades: UPGRADES
            });

            expect(doc.read()).toEqual({ count: 4, one: true, two: true });
        });

        test('a version 2 document reads a version 1 file through the second upgrade only', () => {
            const doc = create({ steps: { $version: 1, data: { count: 4 } } }).doc('steps', {
                fallback: {},
                version: 2,
                upgrades: UPGRADES
            });

            expect(doc.read()).toEqual({ count: 4, two: true });
        });

        test('what a version 2 document writes is read back by a version 2 document', () => {
            const store = create();

            store
                .doc('steps', { fallback: {}, version: 2, upgrades: UPGRADES })
                .write({ count: 1 });

            expect(
                store.doc('steps', { fallback: {}, version: 2, upgrades: UPGRADES }).read()
            ).toEqual({ count: 1 });
        });

        test('what a version 2 document writes is newer than version 1 code', () => {
            const store = create();

            store
                .doc('steps', { fallback: {}, version: 2, upgrades: UPGRADES })
                .write({ count: 1 });

            expect(
                thrownBy(() =>
                    store.doc('steps', { fallback: {}, version: 1, upgrades: UPGRADES }).read()
                )
            ).toBeInstanceOf(CommandError);
        });

        test('a read never writes: the file is still plain JSON afterwards', () => {
            const store = create({ steps: { count: 4 } });

            store.doc('steps', { fallback: {}, version: 2, upgrades: UPGRADES }).read();

            expect(store.doc('steps', { fallback: {} }).read()).toEqual({ count: 4 });
        });

        test('a file newer than the code is a CommandError that names the versions', () => {
            const doc = create({ steps: VERSION_THREE_FILE }).doc('steps', {
                fallback: {},
                version: 2,
                upgrades: UPGRADES
            });

            expect(thrownBy(() => doc.read())).toMatchObject({
                message: expect.stringContaining('is version 3, newer than this code (2)')
            });
        });

        test('the newer-file error has a hint', () => {
            const doc = create({ steps: VERSION_THREE_FILE }).doc('steps', {
                fallback: {},
                version: 2,
                upgrades: UPGRADES
            });

            expect(thrownBy(() => doc.read())).toMatchObject({
                hint: 'Update the app, or reset it to start again from the defaults.'
            });
        });

        test('a missing upgrade step is a TypeError when the document is defined, not when it is read', () => {
            const store = create();

            expect(
                thrownBy(() =>
                    store.doc('steps', { fallback: {}, version: 2, upgrades: { 2: upgradeToTwo } })
                )
            ).toBeInstanceOf(TypeError);
        });

        test.each([{ version: -1 }, { version: 0.5 }])(
            'a file saying $version is a CommandError, not a silent wrong read',
            ({ version }) => {
                const doc = create({ steps: { $version: version, data: { a: 1 } } }).doc('steps', {
                    fallback: {},
                    version: 1,
                    upgrades: { 1: upgradeToOne }
                });

                expect(thrownBy(() => doc.read())).toBeInstanceOf(CommandError);
            }
        );

        test('a version 2 document with no file gives its fallback, unwrapped', () => {
            const doc = create().doc('steps', {
                fallback: { fresh: true },
                version: 2,
                upgrades: UPGRADES
            });

            expect(doc.read()).toEqual({ fresh: true });
        });
    });

    describe(`${label}: named locks`, () => {
        test('runs the work and returns its result', async () => {
            expect(await create().lock('build', () => 'built')).toBe('built');
        });

        test('waits for async work and returns what it resolves to', async () => {
            expect(await create().lock('build', () => Promise.resolve('built later'))).toBe(
                'built later'
            );
        });

        test('can be asked for again once the work is done', async () => {
            const store = create();

            await store.lock('build', () => undefined);

            expect(await store.lock('build', () => 'again')).toBe('again');
        });

        test('can be asked for again after the work failed', async () => {
            const store = create();

            await store
                .lock('build', () => Promise.reject(new Error('build failed')))
                .catch(() => undefined);

            expect(await store.lock('build', () => 'again')).toBe('again');
        });

        test('a nested call for the same lock fails at once, naming it', async () => {
            const store = create();

            await expect(
                store.lock('build', () => store.lock('build', () => 'again'))
            ).rejects.toMatchObject({
                message: 'build is already held by this process.'
            });
        });

        test('unrelated calls for the same lock run one after the other, and none fails', async () => {
            const store = create();
            const order: string[] = [];

            const slowWork = (label: string) => async () => {
                order.push(`${label} starts`);
                await new Promise((resolve) => setTimeout(resolve, WORK_MS));
                order.push(`${label} ends`);
            };

            await Promise.all([
                store.lock('build', slowWork('first'), { pollMs: POLL_MS }),
                store.lock('build', slowWork('second'), { pollMs: POLL_MS })
            ]);

            expect(order).toEqual(['first starts', 'first ends', 'second starts', 'second ends']);
        });

        test('a call made from inside the work of another lock still fails when it asks for the held one', async () => {
            const store = create();

            await expect(
                store.lock('build', () => store.lock('deploy', () => store.lock('build', () => 1)))
            ).rejects.toMatchObject({ message: 'build is already held by this process.' });
        });

        test('a callback scheduled inside the work and run after it is a normal call, not a nested one', async () => {
            const store = create();
            let later: Promise<string> = Promise.resolve('never ran');

            await store.lock('build', () => {
                later = new Promise((resolve) => setTimeout(resolve, WORK_MS)).then(() =>
                    store.lock('build', () => 'ran later')
                );
            });

            expect(await later).toBe('ran later');
        });

        test('onWait is told who holds it, once, however long the wait', async () => {
            const store = create();
            const door = createDoor();
            const told: LockHolder[] = [];

            const first = store.lock('build', () => door.closed);

            const second = store.lock('build', () => 'second', {
                pollMs: POLL_MS,
                onWait: (holder) => told.push(holder)
            });

            await sleepFor(WORK_MS * 3);
            door.open();
            await Promise.all([first, second]);

            expect(told).toEqual([{ pid: process.pid }]);
        });

        test('onWait is not called when the lock is free', async () => {
            const told: LockHolder[] = [];

            await create().lock('build', () => 'free', { onWait: (holder) => told.push(holder) });

            expect(told).toEqual([]);
        });

        test('a wait that outlasts timeoutMs fails, naming who holds it', async () => {
            const store = create();
            const door = createDoor();
            const first = store.lock('build', () => door.closed);

            await expect(
                store.lock('build', () => 'never', { timeoutMs: WORK_MS, pollMs: POLL_MS })
            ).rejects.toMatchObject({
                message: expect.stringContaining(`is locked by process ${process.pid}`)
            });

            door.open();
            await first;
        });

        test('a call that timed out leaves the holder alone, and the lock is free afterwards', async () => {
            const store = create();
            const door = createDoor();
            const first = store.lock('build', () => door.closed.then(() => 'first'));

            await store
                .lock('build', () => 'never', { timeoutMs: WORK_MS, pollMs: POLL_MS })
                .catch(() => undefined);

            door.open();

            expect([await first, await store.lock('build', () => 'free')]).toEqual([
                'first',
                'free'
            ]);
        });

        test('a wait that ends before timeoutMs gets the lock', async () => {
            const store = create();
            const door = createDoor();
            const first = store.lock('build', () => door.closed);

            const second = store.lock('build', () => 'second', {
                timeoutMs: WORK_MS * 20,
                pollMs: POLL_MS
            });

            await sleepFor(POLL_MS);
            door.open();
            await first;

            expect(await second).toBe('second');
        });

        test('different names do not exclude each other', async () => {
            const store = create();

            expect(await store.lock('build', () => store.lock('deploy', () => 'both'))).toBe(
                'both'
            );
        });

        test('a bad name is a TypeError', async () => {
            await expect(async () => create().lock('Bad Name', () => 'x')).rejects.toBeInstanceOf(
                TypeError
            );
        });

        test('a named lock does not stop documents from being written', async () => {
            const store = create();
            const doc = store.doc('steps', { fallback: FALLBACK });

            await store.lock('steps', () => doc.write({ count: 2, tags: [] }));

            expect(doc.read().count).toBe(2);
        });
    });
};
