// Types of the worktrees kit: no type lives in a logic file.

import type { Doc } from '../store/models.js';

export type WorktreeMeta = Record<string, unknown>;

/** What the registry file stores for a worktree. `root` is null for a detached instance. */
export type WorktreeRecord = { slot: number; root: string | null; meta?: WorktreeMeta };

export type WorktreeRecords = Record<string, WorktreeRecord>;

/** One instance of the app: a stable slot, its ports and color. */
export type WorktreeInstance = {
    name: string;
    slot: number;
    root: string | null;
    isMain: boolean;
    meta: WorktreeMeta;
    color: string;
    ports: Record<string, number>;
};

export type IsCheckoutFn = (root: string) => boolean;
export type WorktreesOptions = {
    /**
     * The document the registry is kept in: `store.doc('instances', { fallback: {} })`. The app
     * chooses the store, and with it the folder and how the lock waits.
     */
    registry: Doc<WorktreeRecords>;
    /** Path of the main checkout (slot 0). */
    mainCheckout: string;
    /** Base ports, shifted by `slot * slotStep`. */
    ports: Record<string, number>;
    /** Whether a git root is a checkout of this app; other repos count as outside any checkout. */
    isCheckout?: IsCheckoutFn;
    /** Variable that pins the instance by name, overriding the folder. */
    envVar?: string;
    /** Port shift per slot. Default 100. */
    slotStep?: number;
    /** How many slots there can be, slot 0 (the main checkout) included. Default 20. */
    maxSlots?: number;
    /** One per slot, cycling. */
    colors?: readonly string[];
    /** Name of the main checkout's instance. Default "main". */
    mainName?: string;
    /** Environment to read `envVar` from. Default: the process environment. */
    env?: NodeJS.ProcessEnv;
};

export type CurrentOptions = { cwd?: string };
export type EnsureOptions = { cwd?: string; root?: string; name?: string };
export type EnsureDetachedOptions = { name: string; meta?: WorktreeMeta };

export type Worktrees = {
    /** Every instance: the main one first, then the registered worktrees by slot. */
    list: () => WorktreeInstance[];
    get: (name: string) => WorktreeInstance;
    current: (options?: CurrentOptions) => WorktreeInstance;
    ensure: (options?: EnsureOptions) => WorktreeInstance;
    ensureDetached: (options: EnsureDetachedOptions) => WorktreeInstance;
    remove: (name: string) => void;
};

export type DefineWorktreesFn = (options: WorktreesOptions) => Worktrees;
export type ToWorktreeNameFn = (folder: string) => string;
/** Options with their defaults applied, and the registry document they work on. */
export type KitConfig = {
    registry: Doc<WorktreeRecords>;
    mainRoot: string;
    ports: Record<string, number>;
    isCheckout: IsCheckoutFn;
    envVar: string | undefined;
    slotStep: number;
    maxSlots: number;
    colors: readonly string[];
    mainName: string;
    env: NodeJS.ProcessEnv;
};

/** What turns a record into an instance. */
export type InstanceConfig = Pick<KitConfig, 'ports' | 'slotStep' | 'colors'>;

export type DescribeInstanceFn = (
    config: InstanceConfig,
    name: string,
    record: WorktreeRecord
) => WorktreeInstance;

/** The lowest slot from 1 up that no worktree uses and is below `maxSlots`; undefined when every one is taken. */
export type NextFreeSlotFn = (records: WorktreeRecords, maxSlots: number) => number | undefined;

/** What the port checks need: the base ports of the app, the shift per slot and the number of slots. */
export type PortPlan = { ports: Record<string, number>; slotStep: number; maxSlots: number };

/** Every problem with a port plan, as the lines of one TypeError message; empty when it is sound. */
export type FindPortProblemsFn = (plan: PortPlan) => string[];
export type RecordOfFn = (records: WorktreeRecords, name: string) => WorktreeRecord | undefined;

/** A name that is not taken by a registered worktree or by the main checkout. */
export type UniqueNameFn = (wanted: string, base: string, taken: NameCheck) => string;
export type NameCheck = (name: string) => boolean;
export type IsValidNameFn = (name: string) => boolean;

/** Something that runs with its own arguments, such as a registry operation. */
export type Operation<TArgs extends unknown[], TResult> = (...args: TArgs) => TResult;
