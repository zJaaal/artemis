import { describe, expect, test } from 'vitest';

import { createHeldLocks } from './held.js';

const KEY = 'build.lock';
const TICK_MS = 1;

const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

describe('createHeldLocks', () => {
    test('nothing is held outside any work', () => {
        expect(createHeldLocks().isHeldHere(KEY)).toBe(false);
    });

    test('the lock is held inside the work that holds it', async () => {
        const held = createHeldLocks();

        expect(await held.holding(KEY, () => held.isHeldHere(KEY))).toBe(true);
    });

    test('another lock is not held inside it', async () => {
        const held = createHeldLocks();

        expect(await held.holding(KEY, () => held.isHeldHere('deploy.lock'))).toBe(false);
    });

    test('it is still held after an await inside the work', async () => {
        const held = createHeldLocks();

        const seen = await held.holding(KEY, async () => {
            await tick();

            return held.isHeldHere(KEY);
        });

        expect(seen).toBe(true);
    });

    test('a flow started beside the work, not inside it, does not hold it', async () => {
        const held = createHeldLocks();

        const work = held.holding(KEY, tick);

        expect(held.isHeldHere(KEY)).toBe(false);
        await work;
    });

    test('two copies do not share what they hold', async () => {
        const mine = createHeldLocks();
        const theirs = createHeldLocks();

        expect(await mine.holding(KEY, () => theirs.isHeldHere(KEY))).toBe(false);
    });

    test('a lock held in nested work stays held for the outer work after the inner one ends', async () => {
        const held = createHeldLocks();

        const outer = await held.holding(KEY, async () => {
            await held.holding('deploy.lock', () => undefined);

            return held.isHeldHere(KEY);
        });

        expect(outer).toBe(true);
    });

    test('a callback scheduled inside the work sees the lock as free once the work is done', async () => {
        const held = createHeldLocks();
        let later: () => boolean = () => true;

        await held.holding(KEY, () => {
            later = () => held.isHeldHere(KEY);
        });

        expect(later()).toBe(false);
    });

    test('a callback scheduled inside the work still sees the lock as held while the work runs', async () => {
        const held = createHeldLocks();

        const seen = await held.holding(KEY, async () => {
            const callback = new Promise<boolean>((resolve) =>
                setTimeout(() => resolve(held.isHeldHere(KEY)), TICK_MS)
            );

            return callback;
        });

        expect(seen).toBe(true);
    });
});
