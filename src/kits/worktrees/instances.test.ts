import { describe, expect, test } from 'vitest';

import { KIT_BASE_PORTS, KIT_COLORS, KIT_SLOT_STEP } from '../../test/constants.js';
import { DEFAULT_MAX_SLOTS, FIRST_WORKTREE_SLOT, MAIN_SLOT } from './constants.js';
import { describeInstance, nextFreeSlot, uniqueName } from './instances.js';

const config = { ports: KIT_BASE_PORTS, slotStep: KIT_SLOT_STEP, colors: KIT_COLORS };

describe('describeInstance', () => {
    test('shifts every base port by the slot times the step', () => {
        const instance = describeInstance(config, 'feat', { slot: 2, root: '/w/feat' });

        expect(instance.ports).toEqual({
            http: KIT_BASE_PORTS.http + 2 * KIT_SLOT_STEP,
            frontend: KIT_BASE_PORTS.frontend + 2 * KIT_SLOT_STEP
        });
    });

    test('the main slot keeps the base ports and is the main instance', () => {
        const instance = describeInstance(config, 'main', { slot: MAIN_SLOT, root: '/w/main' });

        expect([instance.ports, instance.isMain]).toEqual([KIT_BASE_PORTS, true]);
    });

    test('a registered slot is not the main instance', () => {
        expect(describeInstance(config, 'feat', { slot: 1, root: '/w' }).isMain).toBe(false);
    });

    test('colors follow the slot and cycle when there are more slots than colors', () => {
        const colors = [0, 1, KIT_COLORS.length].map(
            (slot) => describeInstance(config, 'x', { slot, root: null }).color
        );

        expect(colors).toEqual([KIT_COLORS[0], KIT_COLORS[1], KIT_COLORS[0]]);
    });

    test('metadata defaults to an empty object', () => {
        expect(describeInstance(config, 'x', { slot: 1, root: null }).meta).toEqual({});
    });

    test('metadata of the record is kept', () => {
        const record = { slot: 1, root: null, meta: { image: 'a:1' } };

        expect(describeInstance(config, 'x', record).meta).toEqual({ image: 'a:1' });
    });
});

describe('nextFreeSlot', () => {
    const search = { ports: KIT_BASE_PORTS, slotStep: KIT_SLOT_STEP, maxSlots: DEFAULT_MAX_SLOTS };
    const nothingInUse = () => new Set<number>();

    /** A probe that records what it was asked and says these ports are in use. */
    const probeSaying = (inUse: number[]) => {
        const asked: (readonly number[])[] = [];

        return {
            asked,
            probe: (ports: readonly number[]) => {
                asked.push(ports);

                return new Set(ports.filter((port) => inUse.includes(port)));
            }
        };
    };

    const portsAt = (slot: number) => [
        KIT_BASE_PORTS.http + slot * KIT_SLOT_STEP,
        KIT_BASE_PORTS.frontend + slot * KIT_SLOT_STEP
    ];

    test('is the first worktree slot when nothing is registered', () => {
        expect(nextFreeSlot({}, search, nothingInUse)).toEqual({
            kind: 'slot',
            slot: FIRST_WORKTREE_SLOT
        });
    });

    test('fills the lowest gap', () => {
        const records = {
            a: { slot: FIRST_WORKTREE_SLOT, root: null },
            c: { slot: FIRST_WORKTREE_SLOT + 2, root: null }
        };

        expect(nextFreeSlot(records, search, nothingInUse)).toEqual({
            kind: 'slot',
            slot: FIRST_WORKTREE_SLOT + 1
        });
    });

    test('goes past the last slot when there is no gap', () => {
        const records = { a: { slot: FIRST_WORKTREE_SLOT, root: null } };

        expect(nextFreeSlot(records, search, nothingInUse)).toEqual({
            kind: 'slot',
            slot: FIRST_WORKTREE_SLOT + 1
        });
    });

    test('is full when every slot below the limit is registered', () => {
        const records = {
            a: { slot: FIRST_WORKTREE_SLOT, root: null },
            b: { slot: FIRST_WORKTREE_SLOT + 1, root: null }
        };

        expect(
            nextFreeSlot(records, { ...search, maxSlots: FIRST_WORKTREE_SLOT + 2 }, nothingInUse)
        ).toEqual({
            kind: 'full'
        });
    });

    test('is never slot 0, the main checkout', () => {
        expect(nextFreeSlot({}, search, nothingInUse)).not.toMatchObject({ slot: MAIN_SLOT });
    });

    test('a slot registered past the limit does not matter to the ones below it', () => {
        const records = { far: { slot: DEFAULT_MAX_SLOTS + 5, root: null } };

        expect(nextFreeSlot(records, search, nothingInUse)).toEqual({
            kind: 'slot',
            slot: FIRST_WORKTREE_SLOT
        });
    });

    test('skips a slot with a port in use and takes the next', () => {
        const { probe } = probeSaying([portsAt(FIRST_WORKTREE_SLOT)[0] ?? 0]);

        expect(nextFreeSlot({}, search, probe)).toEqual({
            kind: 'slot',
            slot: FIRST_WORKTREE_SLOT + 1
        });
    });

    test('asks about one slot at a time, lowest first, and stops at the first free one', () => {
        const { probe, asked } = probeSaying([portsAt(FIRST_WORKTREE_SLOT)[1] ?? 0]);

        nextFreeSlot({}, search, probe);

        expect(asked).toEqual([portsAt(FIRST_WORKTREE_SLOT), portsAt(FIRST_WORKTREE_SLOT + 1)]);
    });

    test('asks about a free first candidate only once', () => {
        const { probe, asked } = probeSaying([]);

        nextFreeSlot({}, search, probe);

        expect(asked).toHaveLength(1);
    });

    test('never asks about a slot that is registered', () => {
        const { probe, asked } = probeSaying([]);
        const records = { a: { slot: FIRST_WORKTREE_SLOT, root: null } };

        nextFreeSlot(records, search, probe);

        expect(asked).toEqual([portsAt(FIRST_WORKTREE_SLOT + 1)]);
    });

    test('when every free slot is blocked it says which keys of each are in use', () => {
        const everything = Array.from(
            { length: DEFAULT_MAX_SLOTS },
            (_, slot) => portsAt(slot)[0] ?? 0
        );

        const choice = nextFreeSlot({}, search, probeSaying(everything).probe);

        expect(choice).toMatchObject({
            kind: 'blocked',
            blocked: expect.arrayContaining([
                {
                    slot: FIRST_WORKTREE_SLOT,
                    inUse: [{ key: 'http', port: portsAt(FIRST_WORKTREE_SLOT)[0] }]
                }
            ])
        });
    });

    test('and lists as many blocked slots as there were candidates', () => {
        const everything = Array.from(
            { length: DEFAULT_MAX_SLOTS },
            (_, slot) => portsAt(slot)[0] ?? 0
        );

        const choice = nextFreeSlot({}, search, probeSaying(everything).probe);

        expect(choice.kind === 'blocked' && choice.blocked).toHaveLength(
            DEFAULT_MAX_SLOTS - FIRST_WORKTREE_SLOT
        );
    });
});

describe('uniqueName', () => {
    const takenNames =
        (...names: string[]) =>
        (name: string) =>
            names.includes(name);

    test('is the wanted name when it is free', () => {
        expect(uniqueName('feat', 'feat', takenNames())).toBe('feat');
    });

    test('adds -2 when the name is taken', () => {
        expect(uniqueName('feat', 'feat', takenNames('feat'))).toBe('feat-2');
    });

    test('keeps counting while the suffixed names are taken', () => {
        expect(uniqueName('feat', 'feat', takenNames('feat', 'feat-2'))).toBe('feat-3');
    });

    test('an explicit name that is taken falls back to the base name with a suffix', () => {
        expect(uniqueName('chosen', 'feat', takenNames('chosen'))).toBe('feat-2');
    });
});
