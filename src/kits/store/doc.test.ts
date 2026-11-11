import { afterEach, describe, expect, test, vi } from 'vitest';

import { thrownBy } from '../../test/thrown.js';
import { STORE_INDENT_SPACES } from './constants.js';
import { createDocument } from './doc.js';
import type { DocBackend } from './models.js';

const FILE = '/state/steps.json';
const FALLBACK = { count: 0 };
const TICK_MS = 10;

afterEach(() => {
    vi.restoreAllMocks();
});

/** A backend that keeps text in a map and records every call, so a test sees the order things happen in. */
const recordingBackend = (initial?: string) => {
    const calls: string[] = [];
    let text = initial;

    const backend: DocBackend = {
        readText: () => {
            calls.push('read');

            return text;
        },
        writeText: (_file, next) => {
            calls.push('write');
            text = next;
        },
        reset: () => {
            calls.push('reset');
            text = undefined;
        },
        withLock: (_file, work) => {
            calls.push('lock');
            const result = work();

            calls.push('unlock');

            return result;
        }
    };

    return { backend, calls, text: () => text };
};

describe('createDocument: when the lock is taken', () => {
    test('a read never takes the lock', () => {
        const { backend, calls } = recordingBackend('{"count":1}');

        createDocument(backend, FILE, 'steps', { fallback: FALLBACK }).read();

        expect(calls).toEqual(['read']);
    });

    test('a write takes the lock around the write, and only that', () => {
        const { backend, calls } = recordingBackend();

        createDocument(backend, FILE, 'steps', { fallback: FALLBACK }).write({ count: 1 });

        expect(calls).toEqual(['lock', 'write', 'unlock']);
    });

    test('an update reads and writes inside one lock', () => {
        const { backend, calls } = recordingBackend('{"count":1}');

        createDocument(backend, FILE, 'steps', { fallback: FALLBACK }).update((current) => ({
            count: current.count + 1
        }));

        expect(calls).toEqual(['lock', 'read', 'lock', 'write', 'unlock', 'unlock']);
    });

    test('locked holds the lock while the work reads', () => {
        const { backend, calls } = recordingBackend('{"count":1}');

        createDocument(backend, FILE, 'steps', { fallback: FALLBACK }).locked((doc) => doc.read());

        expect(calls).toEqual(['lock', 'read', 'unlock']);
    });

    test('a reset goes to the backend, which holds the lock itself', () => {
        const { backend, calls } = recordingBackend('{"count":1}');

        createDocument(backend, FILE, 'steps', { fallback: FALLBACK }).reset();

        expect(calls).toEqual(['reset']);
    });
});

describe('createDocument: what is written', () => {
    test('JSON with 4-space indentation and a trailing newline', () => {
        const { backend, text } = recordingBackend();

        createDocument(backend, FILE, 'steps', { fallback: FALLBACK }).write({ count: 1 });

        expect(text()).toBe(`${JSON.stringify({ count: 1 }, null, STORE_INDENT_SPACES)}\n`);
    });

    test('a value that is not JSON is a TypeError naming the document, and nothing is written', () => {
        const { backend, calls } = recordingBackend();
        const doc = createDocument<unknown>(backend, FILE, 'steps', { fallback: null });

        expect([thrownBy(() => doc.write(undefined)), calls]).toEqual([
            expect.objectContaining({
                name: 'TypeError',
                message: expect.stringContaining('steps')
            }),
            []
        ]);
    });

    test('a version 1 document is written wrapped', () => {
        const { backend, text } = recordingBackend();

        createDocument(backend, FILE, 'steps', {
            fallback: FALLBACK,
            version: 1,
            upgrades: { 1: (previous) => previous }
        }).write({ count: 1 });

        expect(JSON.parse(text() ?? '')).toEqual({ $version: 1, data: { count: 1 } });
    });
});

describe('createDocument: a promise where synchronous work was expected', () => {
    test('a rejected promise from locked work is not left as an unhandled rejection', async () => {
        const unhandled = vi.fn();

        process.once('unhandledRejection', unhandled);

        const { backend } = recordingBackend();
        const doc = createDocument(backend, FILE, 'steps', { fallback: FALLBACK });

        thrownBy(() => doc.locked(() => Promise.reject(new Error('async work failed'))));
        await new Promise((resolve) => setTimeout(resolve, TICK_MS));
        process.off('unhandledRejection', unhandled);

        expect(unhandled).not.toHaveBeenCalled();
    });

    test('the error says to use store.lock', () => {
        const { backend } = recordingBackend();
        const doc = createDocument(backend, FILE, 'steps', { fallback: FALLBACK });

        expect(thrownBy(() => doc.locked(() => Promise.resolve()))).toMatchObject({
            message: 'locked() work must be synchronous; use store.lock() for async work'
        });
    });
});
