import { describe, expect, test } from 'vitest';

import { describeStoreContract } from '../../test/store-contract.js';
import { MEMORY_DIR } from './constants.js';
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
