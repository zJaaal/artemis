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
