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
