import path from 'node:path';

import { pathExists, realPathOrResolve } from '../../edges/files.js';
import { workingDirectory } from '../../edges/system.js';
import { CommandError, UsageError } from '../../errors/errors.js';
import { FALLBACK_WORKTREE_NAME, FIRST_WORKTREE_SLOT } from './constants.js';
import type {
    EnsureDetachedOptions,
    EnsureOptions,
    KitConfig,
    NameCheck,
    WorktreeInstance,
    WorktreeRecords
} from './models.js';
import { describeInstance, nextFreeSlot, recordOf, uniqueName } from './instances.js';
import { isValidName, toWorktreeName } from './names.js';
import {
    currentInstance,
    getInstance,
    instanceAt,
    noInstanceError,
    pinnedName,
    rootOf
} from './queries.js';

const isTakenBy =
    (config: KitConfig, records: WorktreeRecords): NameCheck =>
    (name) =>
        Object.hasOwn(records, name) || name === config.mainName;

const isCheckoutRoot = (config: KitConfig, root: string): boolean =>
    pathExists(root) && config.isCheckout(root);

function assertChoosable(config: KitConfig, records: WorktreeRecords, name: string): void {
    if (!isValidName(name)) {
        throw new UsageError(`"${name}" is not a valid instance name.`, {
            hint: 'Use lowercase letters, digits and dashes, e.g. "feat-x".'
        });
    }

    if (isTakenBy(config, records)(name)) {
        throw new UsageError(`Instance "${name}" already belongs to another worktree.`, {
            hint: 'Pick another name.'
        });
    }
}

/** Outside any checkout there is nothing to register: a known name, or the current instance. */
function ensureOutsideCheckout(
    config: KitConfig,
    records: WorktreeRecords,
    cwd: string,
    name: string | undefined
): WorktreeInstance {
    const existing = name ? recordOf(records, name) : undefined;

    if (name && existing) {
        return describeInstance(config, name, existing);
    }

    if (name) {
        throw new UsageError(`Instance "${name}" does not exist yet, so it needs a worktree.`, {
            hint: 'Run it inside the worktree, or pass the worktree path.'
        });
    }

    return currentInstance(config, { cwd });
}

function registerCheckout(
    config: KitConfig,
    records: WorktreeRecords,
    target: string,
    name: string | undefined
): WorktreeInstance {
    const known = instanceAt(config, target);

    if (known) {
        if (name && name !== known.name) {
            throw new UsageError(`${target} is already registered as "${known.name}".`);
        }

        return known;
    }

    if (name) {
        assertChoosable(config, records, name);
    }

    const base = toWorktreeName(path.basename(target)) || FALLBACK_WORKTREE_NAME;
    const finalName = uniqueName(name ?? base, base, isTakenBy(config, records));
    const record = { slot: chooseSlot(config, records), root: target };

    config.registry.write({ ...records, [finalName]: record });

    return describeInstance(config, finalName, record);
}

/** The slot a new instance gets, or a CommandError when every slot below `maxSlots` is registered. */
function chooseSlot(config: KitConfig, records: WorktreeRecords): number {
    const slot = nextFreeSlot(records, config.maxSlots);

    if (slot === undefined) {
        throw new CommandError(`All ${config.maxSlots - FIRST_WORKTREE_SLOT} slots are taken`, {
            hint: 'Remove an instance you no longer need, or raise maxSlots in defineWorktrees.'
        });
    }

    return slot;
}

/**
 * Returns the instance for a checkout, registering it on first use: `root` if given, else the
 * checkout containing `cwd`. Named after its folder (with a suffix if taken) unless `name` is
 * given. Outside any checkout it is the current instance.
 */
export function ensureInstance(
    config: KitConfig,
    { cwd = workingDirectory(), root, name }: EnsureOptions = {}
): WorktreeInstance {
    const pinned = pinnedName(config);

    if (!root && !name && pinned) {
        return getInstance(config, pinned);
    }

    const records = config.registry.read();
    const explicitRoot = root ? realPathOrResolve(root) : undefined;

    if (explicitRoot !== undefined && !isCheckoutRoot(config, explicitRoot)) {
        throw new CommandError(`${explicitRoot} is not a checkout of this app.`, {
            hint: 'Point it at the root of a worktree.'
        });
    }

    const target = explicitRoot ?? rootOf(config, cwd);

    return target
        ? registerCheckout(config, records, target, name)
        : ensureOutsideCheckout(config, records, cwd, name);
}

/**
 * Returns a named instance that belongs to no checkout (e.g. one per container image),
 * registering it on first use with the next free slot. The folder never resolves to it; it is
 * reached by name (get, or the env variable). `meta` is stored with it and updated each time.
 */
export function ensureDetachedInstance(
    config: KitConfig,
    { name, meta = {} }: EnsureDetachedOptions
): WorktreeInstance {
    if (!isValidName(name ?? '') || name === config.mainName) {
        throw new UsageError(`"${name}" is not a valid instance name.`, {
            hint: 'Use lowercase letters, digits and dashes, e.g. "trunk-c467312".'
        });
    }

    const records = config.registry.read();
    const existing = recordOf(records, name);

    if (existing?.root) {
        throw new UsageError(`Instance "${name}" already belongs to ${existing.root}.`, {
            hint: 'Pick another name.'
        });
    }

    const record = { slot: existing?.slot ?? chooseSlot(config, records), root: null, meta };

    config.registry.write({ ...records, [name]: record });

    return describeInstance(config, name, record);
}

/** Forgets a registered worktree, freeing its slot. Never touches the worktree itself. */
export function removeInstance(config: KitConfig, name: string): void {
    if (name === config.mainName) {
        throw new CommandError('The main checkout is not registered, so it cannot be removed.');
    }

    const records = config.registry.read();

    if (!recordOf(records, name)) {
        throw noInstanceError(name);
    }

    config.registry.write(
        Object.fromEntries(Object.entries(records).filter(([key]) => key !== name))
    );
}
