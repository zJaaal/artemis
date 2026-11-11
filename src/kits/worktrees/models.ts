// Types of the worktrees kit: no type lives in a logic file.

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
export type NowFn = () => number;
export type IsProcessAliveFn = (pid: number) => boolean;
export type PauseFn = (ms: number) => void;

/** The clock, process liveness and waiting, injected so lock tests never sleep. */
export type LockEdges = {
    /** The process id written into the lock file. */
    pid: number;
    now: NowFn;
    isProcessAlive: IsProcessAliveFn;
    pause: PauseFn;
    timeoutMs: number;
};

export type WorktreesOptions = {
    /** JSON file the registry is kept in (the app's data folder). */
    stateFile: string;
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
    /** One per slot, cycling. */
    colors?: readonly string[];
    /** Name of the main checkout's instance. Default "main". */
    mainName?: string;
    /** Environment to read `envVar` from. Default: the process environment. */
    env?: NodeJS.ProcessEnv;
    /** Clock for the registry lock. Default: `Date.now`. */
    now?: NowFn;
    /** Process liveness for the registry lock. Default: `process.kill(pid, 0)`. */
    isProcessAlive?: IsProcessAliveFn;
    /** How the lock waits between retries. Default: a blocking wait. */
    pause?: PauseFn;
    /** How long to wait for the lock before giving up. Default 10 seconds. */
    lockTimeoutMs?: number;
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
export type WithLockFn = <TResult>(
    stateFile: string,
    work: () => TResult,
    edges: LockEdges
) => TResult;

/** Options with their defaults applied, and the registry store they work on. */
export type KitConfig = {
    stateFile: string;
    mainRoot: string;
    ports: Record<string, number>;
    isCheckout: IsCheckoutFn;
    envVar: string | undefined;
    slotStep: number;
    colors: readonly string[];
    mainName: string;
    env: NodeJS.ProcessEnv;
    store: RegistryStore;
    lock: LockEdges;
};

/** What turns a record into an instance. */
export type InstanceConfig = Pick<KitConfig, 'ports' | 'slotStep' | 'colors'>;

export type RegistryStore = {
    read: () => WorktreeRecords;
    write: (records: WorktreeRecords) => void;
};

export type CreateRegistryStoreFn = (stateFile: string) => RegistryStore;

export type DescribeInstanceFn = (
    config: InstanceConfig,
    name: string,
    record: WorktreeRecord
) => WorktreeInstance;

export type NextFreeSlotFn = (records: WorktreeRecords) => number;
export type RecordOfFn = (records: WorktreeRecords, name: string) => WorktreeRecord | undefined;

/** A name that is not taken by a registered worktree or by the main checkout. */
export type UniqueNameFn = (wanted: string, base: string, taken: NameCheck) => string;
export type NameCheck = (name: string) => boolean;
export type IsValidNameFn = (name: string) => boolean;

/** Something that runs with its own arguments, such as a registry operation. */
export type Operation<TArgs extends unknown[], TResult> = (...args: TArgs) => TResult;
