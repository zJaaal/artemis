import type { LockEdges } from '../kits/worktrees/models.js';

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

/** The `prompts` package as the test fake sees it. */
export type PromptsFake = {
    /** How many times the `prompts` module was loaded since the last reset. */
    loads: number;
    /** What the user "typed". */
    answers: Record<string, unknown>;
    /** Whether the user pressed Ctrl-C. */
    cancel: boolean;
};

export type PromptsCallbacks = { onCancel: () => unknown };

export type ProjectOptions = {
    /** What the project's `hello` command answers. */
    greeting: string;
    /** Extra fields for its package.json, such as `{ artemis: { commandsDir: 'tools' } }`. */
    manifest?: Record<string, unknown>;
    /** Folder of the commands, relative to the project. Default "commands". */
    commandsFolder?: string;
};
