// Types of both kits, as the standards want: no type lives in a logic file.

// ---------------------------------------------------------------------------------------------
// Terminal kit
// ---------------------------------------------------------------------------------------------

/** One terminal pane: a folder, the commands to type in it, and whether it takes focus. */
export type TerminalPane = { dir: string; run?: readonly string[]; focus?: boolean };

/** `horizontal` puts children side by side, `vertical` stacks them. */
export type SplitDirection = 'horizontal' | 'vertical';

export type TerminalSplit = { split: SplitDirection; children: readonly TerminalLayout[] };

export type TerminalLayout = TerminalPane | TerminalSplit;

type TabBase = { id: string; name: string; title?: string; color?: string };

/** A tab is either a flat list of panes (left to right) or a layout tree of splits. */
export type TerminalTab =
    | (TabBase & { panes: readonly TerminalPane[]; layout?: never })
    | (TabBase & { layout: TerminalLayout; panes?: never });

/** What an adapter does with a tab: write its config, open it, remove it. */
export type Terminal = {
    write: (tab: TerminalTab) => void;
    open: (id: string) => void;
    remove: (id: string) => void;
};

export type OpenLinkFn = (url: string) => void;

export type WarpOptions = {
    /** Where Warp reads Tab Configs from. Default: `~/.warp/tab_configs`. */
    configDir?: string;
    /** How a link is opened. Default: macOS `open`. */
    open?: OpenLinkFn;
};

export type WarpFn = (options?: WarpOptions) => Terminal;
export type OpenTabsFn = (terminal: Terminal, tabs: readonly TerminalTab[]) => void;

/** A pane or split with the id Warp refers to it by. */
export type IdentifiedNode =
    | (TerminalPane & { id: string })
    | { split: SplitDirection; id: string; children: IdentifiedNode[] };

export type IdCounters = { pane: number; split: number };

export type ToTomlFn = (tab: TerminalTab) => string;

// ---------------------------------------------------------------------------------------------
// Worktrees kit
// ---------------------------------------------------------------------------------------------

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
