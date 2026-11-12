import { FIRST_SUFFIX, FIRST_WORKTREE_SLOT, MAIN_SLOT } from './constants.js';
import type {
    BlockedSlot,
    DescribeInstanceFn,
    NextFreeSlotFn,
    PortsOfSlotFn,
    RecordOfFn,
    SlotSearch,
    UniqueNameFn,
    WorktreeRecords
} from './models.js';

/** The ports of one slot, by key: each base shifted by the slot times the step. */
export const portsOfSlot: PortsOfSlotFn = (config, slot) =>
    Object.fromEntries(
        Object.entries(config.ports).map(([key, port]) => [key, port + slot * config.slotStep])
    );

/** A record of the registry as an instance: its ports shifted by slot, and its color by slot. */
export const describeInstance: DescribeInstanceFn = (config, name, record) => ({
    name,
    slot: record.slot,
    root: record.root,
    isMain: record.slot === MAIN_SLOT,
    meta: record.meta ?? {},
    color: config.colors[record.slot % config.colors.length] ?? '',
    ports: portsOfSlot(config, record.slot)
});

/** The record of a registered name. Only the registry's own entries count, never `constructor` and friends. */
export const recordOf: RecordOfFn = (records, name) =>
    Object.hasOwn(records, name) ? records[name] : undefined;

/** The slots a new instance could take, lowest first: from 1 up to `maxSlots - 1`, none registered. */
const candidateSlots = (records: WorktreeRecords, maxSlots: number): number[] => {
    const used = new Set(Object.values(records).map((record) => record.slot));

    return Array.from(
        { length: maxSlots - FIRST_WORKTREE_SLOT },
        (_, index) => index + FIRST_WORKTREE_SLOT
    ).filter((slot) => !used.has(slot));
};

/** The keys of a slot whose port is in use, with the port. */
const portsBlocking = (
    search: SlotSearch,
    slot: number,
    inUse: ReadonlySet<number>
): BlockedSlot['inUse'] =>
    Object.entries(portsOfSlot(search, slot))
        .filter(([, port]) => inUse.has(port))
        .map(([key, port]) => ({ key, port }));

/**
 * The lowest slot that is free to give out. Slot 0 is the main checkout, and a registered slot is
 * its instance's for good. `probe` is asked about one candidate at a time, lowest first, and the
 * search stops at the first one with nothing in use, so a normal call asks once.
 */
export const nextFreeSlot: NextFreeSlotFn = (records, search, probe) => {
    const candidates = candidateSlots(records, search.maxSlots);
    const blocked: BlockedSlot[] = [];

    for (const slot of candidates) {
        const inUse = portsBlocking(search, slot, probe(Object.values(portsOfSlot(search, slot))));

        if (!inUse.length) {
            return { kind: 'slot', slot };
        }

        blocked.push({ slot, inUse });
    }

    return blocked.length ? { kind: 'blocked', blocked } : { kind: 'full' };
};

/** `wanted`, or `base-2`, `base-3`... when it is taken. */
export const uniqueName: UniqueNameFn = (wanted, base, isTaken) => {
    let name = wanted;

    for (let suffix = FIRST_SUFFIX; isTaken(name); suffix++) {
        name = `${base}-${suffix}`;
    }

    return name;
};
