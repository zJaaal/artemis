import { FIRST_SUFFIX, FIRST_WORKTREE_SLOT, MAIN_SLOT } from '../constants.js';
import type { DescribeInstanceFn, NextFreeSlotFn, UniqueNameFn } from '../models.js';

/** A record of the registry as an instance: its ports shifted by slot, and its color by slot. */
export const describeInstance: DescribeInstanceFn = (config, name, record) => ({
    name,
    slot: record.slot,
    root: record.root,
    isMain: record.slot === MAIN_SLOT,
    meta: record.meta ?? {},
    color: config.colors[record.slot % config.colors.length] ?? '',
    ports: Object.fromEntries(
        Object.entries(config.ports).map(([key, port]) => [
            key,
            port + record.slot * config.slotStep
        ])
    )
});

/** The lowest slot no registered worktree uses. Slot 0 is the main checkout. */
export const nextFreeSlot: NextFreeSlotFn = (records) => {
    const used = new Set(Object.values(records).map((record) => record.slot));
    let slot = FIRST_WORKTREE_SLOT;

    while (used.has(slot)) {
        slot++;
    }

    return slot;
};

/** `wanted`, or `base-2`, `base-3`... when it is taken. */
export const uniqueName: UniqueNameFn = (wanted, base, isTaken) => {
    let name = wanted;

    for (let suffix = FIRST_SUFFIX; isTaken(name); suffix++) {
        name = `${base}-${suffix}`;
    }

    return name;
};
