// Types of the store kit: no type lives in a logic file.

import type { CommandError } from '../../errors/errors.js';

export type NowFn = () => number;
export type IsProcessAliveFn = (pid: number) => boolean;
export type PauseFn = (ms: number) => void;
export type SleepFn = (ms: number) => Promise<void>;
export type TokenFn = () => string;

/** Who holds a lock. `pid` is undefined while the holder is still writing the file. */
export type LockHolder = { pid: number | undefined };

/** The clock, process liveness and waiting, injected so lock tests never sleep. */
export type LockEdges = {
    /** The process id written into the lock file. */
    pid: number;
    /** Tells this holder apart from any other holder with the same pid. */
    token: TokenFn;
    now: NowFn;
    isProcessAlive: IsProcessAliveFn;
    /** A blocking wait, used by the synchronous driver. */
    pause: PauseFn;
    /** A non-blocking wait, used by the asynchronous driver. */
    sleep: SleepFn;
    timeoutMs: number;
};

/** One attempt to take a lock: where it is, who is asking, and what is needed to judge its holder. */
export type LockAttempt = {
    lock: string;
    ownership: string;
    edges: Pick<LockEdges, 'now' | 'isProcessAlive'>;
};

/** One attempt to take a lock, as data, so a synchronous and an asynchronous driver share it. */
export type LockStep =
    { kind: 'acquired' } | { kind: 'wait'; holder: LockHolder } | { kind: 'retry' };

/** Creates the lock exclusively, or judges its holder: wait for it, or take over and retry. */
export type TryLockFn = (attempt: LockAttempt) => LockStep;

export type WithLockSyncFn = <TResult>(
    file: string,
    work: () => TResult,
    edges: LockEdges
) => TResult;

/** What a named lock reports while it waits, and when it gives up. */
export type NamedLockOptions = {
    /** Called once, when the lock is first found taken. */
    onWait?: (holder: LockHolder) => void;
    /** How often to look again. Default `NAMED_LOCK_POLL_MS`. */
    pollMs?: number;
    /** How long to wait before giving up. Default: as long as it takes. */
    timeoutMs?: number;
};

export type WithLockAsyncFn = <TResult>(
    file: string,
    work: () => TResult | Promise<TResult>,
    edges: LockEdges,
    options?: NamedLockOptions
) => Promise<TResult>;

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

export type UpgradeFn = (previous: unknown) => unknown;

/** `{ 1: (v0) => v1, 2: (v1) => v2 }`, keyed by the version each function produces. */
export type Upgrades = Readonly<Record<number, UpgradeFn>>;

export type DocOptions<T> = {
    /** What `read()` returns when the file does not exist; always a copy. */
    fallback: T;
    /** Default 0: the file is plain JSON. */
    version?: number;
    upgrades?: Upgrades;
};

/** What a file holds once its version wrapper is taken off. */
export type VersionedValue = { version: number; value: unknown };

export type Doc<T> = {
    readonly name: string;
    /** Absolute path of the file. */
    readonly file: string;
    /** No lock. A fresh copy every time; upgrades are applied in memory and never written by a read. */
    read: () => T;
    /** Under the lock, atomic (temporary file, then rename). */
    write: (value: T) => void;
    /** Read, change and write as one step under the lock. Returns what it wrote. */
    update: (change: (current: T) => T) => T;
    /** Holds the lock for a read-modify-write that may write nothing. Synchronous work only. */
    locked: <R>(work: (doc: Doc<T>) => R) => R;
    /** Under the lock, deletes the file without reading it: the next read returns the fallback. */
    reset: () => void;
};

export type Store = {
    readonly dir: string;
    doc: <T>(name: string, options: DocOptions<T>) => Doc<T>;
    lock: <R>(name: string, work: () => R | Promise<R>, options?: NamedLockOptions) => Promise<R>;
};

/** The clock, liveness and waiting of the lock, injectable so tests never sleep. All optional. */
export type LockOptions = {
    now?: NowFn;
    isProcessAlive?: IsProcessAliveFn;
    pause?: PauseFn;
    sleep?: SleepFn;
    /** Documents give up after this long. Default 10 s. */
    lockTimeoutMs?: number;
};

/** Where a store keeps its documents: a folder, or the project's `"artemis".stateDir`. */
export type StoreOptions = ({ dir: string } | { project: string | URL }) & LockOptions;

export type FolderOfProjectFn = (location: string | URL) => string;
export type ResolveProjectDirFn = (location: string | URL) => string;

export type MemoryStoreOptions = { documents?: Record<string, unknown> };

export type DefineStoreFn = (options: StoreOptions) => Store;
export type CreateMemoryStoreFn = (options?: MemoryStoreOptions) => Store;

export type IsValidDocNameFn = (name: string) => boolean;
export type AssertDocNameFn = (name: string) => void;
export type WrapVersionFn = (value: unknown, version: number) => unknown;
export type UnwrapVersionFn = (parsed: unknown) => VersionedValue;
export type UpgradeValueFn = (
    file: string,
    found: VersionedValue,
    version: number,
    upgrades: Upgrades
) => unknown;
/** Why a version found in a file cannot be one, or undefined when it can. */
export type InvalidVersionMessageFn = (file: string, version: number) => string | undefined;
export type AssertUpgradesFn = (name: string, version: number, upgrades: Upgrades) => void;

// ---------------------------------------------------------------------------------------------
// Where documents live: the disk, or memory
// ---------------------------------------------------------------------------------------------

/** What a document needs from wherever its text is kept. The disk and the memory store each have one. */
export type DocBackend = {
    readText: (file: string) => string | undefined;
    /** Replaces the text in one piece. The caller holds the lock. */
    writeText: (file: string, text: string) => void;
    /** Deletes the document under its lock, without reading it. */
    reset: (file: string) => void;
    /** Holds the lock while `work` runs. Reentrant: `work` may call back into the same document. */
    withLock: <TResult>(file: string, work: () => TResult) => TResult;
};

export type CreateDocumentFn = <T>(
    backend: DocBackend,
    file: string,
    name: string,
    options: DocOptions<T>
) => Doc<T>;

/** What a document file says, read without a fallback or upgrades. */
export type InspectedDocument = { version: number; data: unknown } | { error: string };

export type InspectDocumentFn = (file: string) => InspectedDocument;
/** Takes resolved edges, not `LockOptions`: the two shapes overlap, and mixing them loses a setting. */
export type RemoveDocumentFn = (file: string, edges: LockEdges) => void;
export type ResolveLockEdgesFn = (options?: LockOptions) => LockEdges;

/** The JSON a text holds, or why it is not JSON. */
export type ParsedText = { parsed: unknown } | { error: string };
export type ParseDocumentTextFn = (file: string, text: string) => ParsedText;

/** Runs named work under a lock of that name. */
export type NamedLockRunner = Store['lock'];
export type AssembleStoreFn = (dir: string, backend: DocBackend, lock: NamedLockRunner) => Store;
export type AlreadyHeldErrorFn = (name: string) => CommandError;

/** Which locks the current asynchronous flow holds: what tells a nested call from a concurrent one. */
export type HeldLocks = {
    /** Whether the code running now is inside the work of a call that holds this lock. */
    isHeldHere: (key: string) => boolean;
    /** Runs `work` as holding `key`: what it starts sees it as held until `work` settles. */
    holding: <TResult>(key: string, work: () => TResult | Promise<TResult>) => Promise<TResult>;
};
/** One lock held by a flow; `active` goes false when its work settles, though the flow lives on. */
export type HeldFrame = { key: string; active: boolean };
export type CreateHeldLocksFn = () => HeldLocks;
