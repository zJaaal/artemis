import { describe, expect, test } from 'vitest';

import { createFakeClock } from '../../test/lock-edges.js';
import { describeStoreContract } from '../../test/store-contract.js';
import { MEMORY_DIR, NAMED_LOCK_POLL_MS } from './constants.js';
import { createMemoryStore } from './memory.js';

describeStoreContract('memory store', (documents) =>
    createMemoryStore(documents ? { documents } : {})
);

describe('createMemoryStore', () => {
    test('takes no options at all', () => {
        expect(
            createMemoryStore()
                .doc('steps', { fallback: { count: 0 } })
                .read()
        ).toEqual({
            count: 0
        });
    });

    test('keeps its documents under a folder that is only a name', () => {
        expect(createMemoryStore().dir).toBe(MEMORY_DIR);
    });

    test('two memory stores share nothing', () => {
        const first = createMemoryStore();
        const second = createMemoryStore();

        first.doc('steps', { fallback: { count: 0 } }).write({ count: 5 });

        expect(second.doc('steps', { fallback: { count: 0 } }).read()).toEqual({ count: 0 });
    });

    test('what it was given at the start is not changed by what a read returned', () => {
        const documents = { steps: { tags: ['a'] } };

        const doc = createMemoryStore({ documents }).doc('steps', {
            fallback: { tags: [] as string[] }
        });

        doc.read().tags.push('changed');

        expect(documents).toEqual({ steps: { tags: ['a'] } });
    });
});

describe('createMemoryStore: named locks on an injected clock', () => {
    const TIMEOUT_MS = 5000;
    const POLL_MS = 1000;

    /** A store whose `build` lock is held by a call that never lets go, and a clock that never really waits. */
    const heldStore = () => {
        const clock = createFakeClock();
        const store = createMemoryStore({ now: clock.now, sleep: clock.sleep });

        void store.lock('build', () => new Promise(() => undefined));

        return { store, clock };
    };

    test('a timeout is reached through the injected clock, without really waiting', async () => {
        const { store } = heldStore();

        await expect(
            store.lock('build', () => 'never', { timeoutMs: TIMEOUT_MS, pollMs: POLL_MS })
        ).rejects.toMatchObject({ message: expect.stringContaining('is locked by process') });
    });

    test('it sleeps pollMs between checks', async () => {
        const { store, clock } = heldStore();

        await store
            .lock('build', () => 'never', { timeoutMs: TIMEOUT_MS, pollMs: POLL_MS })
            .catch(() => undefined);

        expect(new Set(clock.naps)).toEqual(new Set([POLL_MS]));
    });

    test('it checks as many times as the timeout allows', async () => {
        const { store, clock } = heldStore();

        await store
            .lock('build', () => 'never', { timeoutMs: TIMEOUT_MS, pollMs: POLL_MS })
            .catch(() => undefined);

        expect(clock.naps).toHaveLength(TIMEOUT_MS / POLL_MS);
    });

    test('without pollMs it sleeps the default named-lock poll', async () => {
        const { store, clock } = heldStore();

        await store.lock('build', () => 'never', { timeoutMs: TIMEOUT_MS }).catch(() => undefined);

        expect(clock.naps[0]).toBe(NAMED_LOCK_POLL_MS);
    });

    test('with no timeout it never sleeps: it waits for the holder to let go', async () => {
        const clock = createFakeClock();
        const store = createMemoryStore({ now: clock.now, sleep: clock.sleep });
        const first = store.lock('build', () => Promise.resolve('first'));
        const second = store.lock('build', () => 'second');

        await Promise.all([first, second]);

        expect(clock.naps).toEqual([]);
    });
});
