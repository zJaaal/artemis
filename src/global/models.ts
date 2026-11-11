import type { ResolveHook } from 'node:module';

import type { IsFolderFn, OutputSink } from '../models.js';

/** Where the commands of a run came from. */
export type CommandsSource = 'env' | 'project' | 'user';

export type CommandsLocation = { dir: string; source: CommandsSource };

export type LocateInput = {
    cwd: string;
    home: string;
    env: NodeJS.ProcessEnv;
    isFolder: IsFolderFn;
};

export type LocateResult =
    { kind: 'found'; location: CommandsLocation } | { kind: 'missing'; searched: string[] };

export type LocateCommandsFn = (input: LocateInput) => LocateResult;

export type UserCommandsDirFn = (home: string, env: NodeJS.ProcessEnv) => string;
export type AncestorsFn = (dir: string) => string[];

/** What the global binary reads from the machine; every field defaults to the real thing. */
export type GlobalOptions = {
    cwd?: string | undefined;
    home?: string | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    stdout?: OutputSink | undefined;
    stderr?: OutputSink | undefined;
    interactive?: boolean | undefined;
    color?: boolean | undefined;
};

export type MainFn = (argv: string[], options?: GlobalOptions) => Promise<number>;

/** The module resolution hook that points command files at the running copy of the package. */
export type ResolveHookFn = ResolveHook;
