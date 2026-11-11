import { expect, test } from 'vitest';

import { createMemoryStore } from './memory.js';

// Its own file: a timer another test leaves running would be counted here too.

const LONG_POLL_MS = 600_000;
const HOLD_MS = 5;

const pendingTimers = (): number =>
    process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;

test('a named lock wait on the real clock leaves no timer pending once the holder lets go', async () => {
    const store = createMemoryStore();
    const before = pendingTimers();

    const holder = store.lock(
        'build',
        () => new Promise((resolve) => setTimeout(resolve, HOLD_MS))
    );

    const waiter = store.lock('build', () => 'built', {
        pollMs: LONG_POLL_MS,
        timeoutMs: LONG_POLL_MS
    });

    await Promise.all([holder, waiter]);

    expect(pendingTimers()).toBe(before);
});
