import type { ExitCode, PromptStreams } from '../models.js';
import type { LockEdges, LockOptions, NowFn, SleepFn, Store } from '../kits/store/models.js';

/** Types of the test helpers. Only tests import from `src/test`. */

/** An in-memory stand-in for stdout or stderr: collects every chunk written to it. */
export type Sink = {
    write: (chunk: string) => boolean;
    readonly text: string;
};

/** A folder-per-test helper: makes temporary folders and removes them all afterwards. */
export type TempFolders = {
    make: (prefix: string) => string;
    cleanUp: () => void;
};

/** A git repository created in a temporary folder. */
export type TempRepo = {
    root: string;
    git: (...args: string[]) => string;
};

/** What `art(...)` returns: the exit code and everything written to stdout and stderr. */
export type ArtResult = { code: number; out: string; err: string };

/** The JSON object printed on stdout under --json. */
export type Envelope = {
    ok: boolean;
    command: string | null;
    result?: unknown;
    error?: string;
    hint?: string;
    dryRun?: boolean;
    plan?: string[];
    next?: string[];
    log?: string;
    tail?: string[];
    checks?: unknown[];
};

/** `defineCommand` seen from a JavaScript caller: it can be handed anything. */
export type LooseDefineFn = (definition: unknown) => unknown;

/** Runs `work` and returns what it threw, or undefined. Keeps try/catch out of test bodies. */
export type ThrownByFn = (work: () => unknown) => unknown;

export type FakeLockEdgesOptions = {
    /** The process id the lock file will carry. */
    pid?: number;
    isProcessAlive: (pid: number) => boolean;
    timeoutMs: number;
    /** Runs on every pause: what the other process did while we waited. */
    onPause?: () => void;
};

export type FakeLockEdges = {
    edges: LockEdges;
    /** Every pause the lock asked for, in ms. */
    pauses: number[];
};

export type FakeLockOptions = {
    options: LockOptions;
    /** Every pause the lock asked for, in ms. */
    pauses: number[];
};

/** A clock that only moves when something sleeps: a wait costs no real time. */
export type FakeClock = {
    now: NowFn;
    sleep: SleepFn;
    /** Every sleep asked for, in ms. */
    naps: number[];
};

/** One call to the `@topcli/prompts` fake: which function, what it was asked, and with what options. */
export type PromptsCall = { fn: string; message: string; options: Record<string, unknown> };

/** The `@topcli/prompts` package as the test fake sees it. */
export type PromptsFake = {
    /** How many times the package was loaded since the last reset. */
    loads: number;
    /** Every question it was asked. */
    calls: PromptsCall[];
    /** What the user "typed". */
    answer: unknown;
    /** Whether the user pressed Ctrl+C: the call rejects with an error named AbortError. */
    abort: boolean;
    /** Whether the call waits until its `signal` fires, as a question waiting for a key does. */
    waitForSignal: boolean;
    /** An error the call rejects with, as when the package fails after it started listening. */
    failure: Error | undefined;
};

/** A stdin that is a terminal: it takes written bytes as keys and records raw mode changes. */
export type FakeTty = {
    stdin: PromptStreams['stdin'];
    stdout: PromptStreams['stdout'];
    /** What the user types. */
    type: (keys: string) => void;
    /** Every `setRawMode` argument, in order. */
    rawModes: boolean[];
    /** Everything written to stdout so far. */
    written: () => string;
    /** How many `keypress` listeners stdin has right now. */
    keypressListeners: () => number;
    /** Whether stdin has stopped flowing, so it no longer keeps the process alive. */
    isPaused: () => boolean;
};

export type ProjectOptions = {
    /** What the project's `hello` command answers. */
    greeting: string;
    /** Extra fields for its package.json, such as `{ artemis: { commandsDir: 'tools' } }`. */
    manifest?: Record<string, unknown>;
    /** Folder of the commands, relative to the project. Default "commands". */
    commandsFolder?: string;
};

export type ForeignErrorOptions = {
    hint?: string;
    exitCode?: ExitCode;
    /** A value that is not an exit code (or `undefined`), as a copy that sends something odd would. */
    invalidExitCode?: unknown;
    usage?: string;
    /** Whether it is also tagged as a usage error. */
    isUsage?: boolean;
};

/** Makes a store holding these documents, as they would be on disk (a versioned one wraps its data). */
export type CreateStoreFn = (documents?: Record<string, unknown>) => Store;

export type StateProjectOptions = {
    /** `"artemis".stateDir`; the default folder "state" when left out. */
    stateDir?: string;
    /** Documents by name: a string is written as it is, anything else as JSON. */
    documents?: Record<string, unknown>;
    /** Other files in the state folder (locks, temporary files), by name. */
    files?: Record<string, string>;
};

/** The shape of a generated tree of commands (see `writeGeneratedCommands`). */
export type GeneratedTree = {
    topics: number;
    perTopic: number;
    nestedPerTopic: number;
    topLevel: number;
};
