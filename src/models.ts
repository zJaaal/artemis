import type { ResolveHook } from 'node:module';
import type { ParseArgsConfig } from 'node:util';

import type { PromptObject } from 'prompts';

import type { EXIT_CODE, STYLE_CODES } from './constants.js';

// ---------------------------------------------------------------------------------------------
// Definitions: what a command file declares
// ---------------------------------------------------------------------------------------------

export type FlagDefinition = {
    type: 'boolean' | 'string';
    short?: string;
    multiple?: boolean;
    default?: boolean | string | readonly string[];
    choices?: readonly string[];
    description?: string;
};

export type FlagDefinitions = Record<string, FlagDefinition>;

/** What a command without `flags` declares. */
export type NoFlags = Record<never, FlagDefinition>;

export type ArgDefinition = {
    name: string;
    description?: string;
    required?: boolean;
    default?: string;
    choices?: readonly string[];
};

export type ArgDefinitions = readonly ArgDefinition[];

// ---------------------------------------------------------------------------------------------
// Inference: what run() receives, derived from the definition (types only, no runtime effect)
// ---------------------------------------------------------------------------------------------

/** The union of a definition's `choices`, or `string` when it has none. */
type ChoiceOf<TDefinition> = TDefinition extends {
    readonly choices: readonly (infer TChoice extends string)[];
}
    ? TChoice
    : string;

type ArgValue<TArg extends ArgDefinition> = TArg extends { readonly required: true }
    ? ChoiceOf<TArg>
    : TArg extends { readonly default: string }
      ? ChoiceOf<TArg>
      : ChoiceOf<TArg> | undefined;

// A flag declared with the wide `FlagDefinition` itself (not as a constant) has no known value type.
type FlagValue<TFlag extends FlagDefinition> = FlagDefinition extends TFlag
    ? unknown
    : TFlag extends { readonly type: 'boolean' }
      ? TFlag extends { readonly default: boolean }
          ? boolean
          : boolean | undefined
      : TFlag extends { readonly multiple: true }
        ? TFlag extends { readonly default: readonly string[] }
            ? ChoiceOf<TFlag>[]
            : ChoiceOf<TFlag>[] | undefined
        : TFlag extends { readonly default: string }
          ? ChoiceOf<TFlag>
          : ChoiceOf<TFlag> | undefined;

/** A required or defaulted arg is a string; an optional one may be undefined; `choices` narrow it. */
export type InferArgs<TArgs extends ArgDefinitions> = {
    [TArg in TArgs[number] as TArg['name']]: ArgValue<TArg>;
};

/** Boolean flags are booleans, string flags strings, `multiple` ones arrays; a default removes `undefined`. */
export type InferFlags<TFlags extends FlagDefinitions> = {
    -readonly [TName in keyof TFlags]: FlagValue<TFlags[TName]>;
};

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

/** Color helpers; they return the text untouched when color is off. */
export type StyleFn = (text: unknown) => string;
export type StyleCodes = Record<string, number>;
export type Style = Record<keyof typeof STYLE_CODES, StyleFn>;

export type LogFn = (...parts: unknown[]) => void;
export type PromptOptions = { hint?: string };
export type PromptFn = (
    questions: PromptObject | PromptObject[],
    options?: PromptOptions
) => Promise<Record<string, unknown>>;
export type InvokeFn = (id: string, argv?: string[]) => Promise<unknown>;

/** What the prompts edge returns: the answers, and whether the user cancelled. */
export type PromptResult = { answers: Record<string, unknown>; cancelled: boolean };
export type AskFn = (questions: PromptObject | PromptObject[]) => Promise<PromptResult>;

/** The `ctx` a command receives. */
export type CommandContext = {
    json: boolean;
    interactive: boolean;
    style: Style;
    /** Human-readable output on stdout. Suppressed with --json. */
    log: LogFn;
    /** Progress and warnings on stderr; they never mix with --json output. */
    warn: LogFn;
    /** Asks the user, or throws a CommandError with a hint when nobody can answer. */
    prompt: PromptFn;
    /** Every discovered command. */
    commands: CommandEntry[];
    /** Runs another command by id or alias and returns its result. Inherits --json and --yes. */
    invoke: InvokeFn;
};

/** Where output goes, and what the command was told about how it runs. */
export type ContextParts = {
    io: IO;
    global: GlobalFlags;
    interactive: boolean;
    style: Style;
    registry: Registry;
    invoke: InvokeFn;
};

export type CreateContextFn = (parts: ContextParts) => CommandContext;

export type RunInput<TArgs extends ArgDefinitions, TFlags extends FlagDefinitions> = {
    args: InferArgs<TArgs>;
    flags: InferFlags<TFlags>;
    ctx: CommandContext;
};

export type RunFn<TArgs extends ArgDefinitions, TFlags extends FlagDefinitions> = (
    input: RunInput<TArgs, TFlags>
) => unknown;

// Trade-off, accepted: the index signature keeps extra fields passing through untouched (the dotCMS
// `step` convention) but means a typo in a field name is not a type error. Known fields stay typed.
export type CommandDefinition<
    TArgs extends ArgDefinitions = ArgDefinitions,
    TFlags extends FlagDefinitions = FlagDefinitions
> = {
    description: string;
    run: RunFn<TArgs, TFlags>;
    args?: TArgs;
    flags?: TFlags;
    aliases?: readonly string[];
    examples?: readonly string[];
    [extra: string]: unknown;
};

/** What `defineCommand` returns: the definition with its defaults filled in. */
export type Command<
    TArgs extends ArgDefinitions = ArgDefinitions,
    TFlags extends FlagDefinitions = FlagDefinitions
> = CommandDefinition<TArgs, TFlags> & {
    args: TArgs;
    flags: TFlags;
    aliases: readonly string[];
    examples: readonly string[];
};

/** What `defineTopic` takes: only the description is kept. */
export type TopicDefinition = { description?: string };

/** What `defineTopic` returns. */
export type Topic = { readonly description: string };

export type DefineCommandFn = <
    const TArgs extends ArgDefinitions = [],
    const TFlags extends FlagDefinitions = NoFlags
>(
    definition: CommandDefinition<TArgs, TFlags>
) => Command<TArgs, TFlags>;

/** Reads the tag a definition carries at runtime. */
export type IsTaggedFn = (value: unknown, tag: symbol) => boolean;
export type IsCommandErrorFn = (value: unknown) => value is CommandErrorShape;
export type IsUsageErrorFn = (value: unknown) => value is UsageErrorShape;

export type DefineTopicFn = (definition?: TopicDefinition) => Topic;
export type IsCommandFn = (value: unknown) => value is Command;
export type IsTopicFn = (value: unknown) => value is Topic;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

/** What a failure looks like to the reporter, whichever copy of Artemis threw it. */
export type CommandErrorShape = Error & {
    hint: string | undefined;
    exitCode: ExitCode;
};
export type UsageErrorShape = CommandErrorShape & { usage: string | undefined };

export type CommandErrorOptions = {
    hint?: string | undefined;
    exitCode?: ExitCode;
    cause?: unknown;
};
export type UsageErrorOptions = { hint?: string | undefined; usage?: string | undefined };

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

export type GlobalFlags = { help: boolean; json: boolean; yes: boolean };

export type ParsedCommandLine = {
    args: Record<string, string | undefined>;
    flags: Record<string, unknown>;
    global: GlobalFlags;
};

export type ParseTarget = Pick<Command, 'args' | 'flags'>;
export type ParseFn = (
    definition: ParseTarget,
    argv: readonly string[],
    usage: string
) => ParsedCommandLine;

export type ParseOptions = NonNullable<ParseArgsConfig['options']>;
export type ParseOptionDescriptor = ParseOptions[string];
export type ParsedValues = Record<string, string | boolean | (string | boolean)[] | undefined>;

/** A value to check against the `choices` of the arg or flag it was given for. */
export type ChoiceCheck = {
    kind: 'argument' | 'value for flag';
    name: string;
    value: unknown;
    choices: readonly string[] | undefined;
    usage: string;
};

// ---------------------------------------------------------------------------------------------
// Discovery and resolution
// ---------------------------------------------------------------------------------------------

export type CommandEntry = { id: string; file: string; definition: Command };
export type TopicEntry = { id: string; description: string };

export type Registry = {
    commands: Map<string, CommandEntry>;
    topics: Map<string, TopicEntry>;
    /** Alias -> command id. */
    aliases: Map<string, string>;
    warnings: string[];
};

export type DiscoverFn = (commandsDir: string) => Promise<Registry>;

/** What discovery needs to know about a folder entry. */
export type DirectoryEntry = { name: string; isDirectory: boolean };

/** Where discovery is: the registry being filled and the folder it started from. */
export type WalkContext = { registry: Registry; root: string };

export type ListDirectoryFn = (dir: string) => DirectoryEntry[];
export type PathExistsFn = (path: string) => boolean;
export type IsFolderFn = (path: string) => boolean;
export type MakeDirectoryFn = (dir: string) => void;
export type ReadTextIfExistsFn = (file: string) => string | undefined;
/** Creates the file only if it does not exist yet; false means someone else has it. */
export type CreateExclusiveFn = (file: string, text: string) => boolean;
/** When a file was last written, in ms since the epoch, or undefined when it is not there. */
export type ModifiedAtFn = (file: string) => number | undefined;
export type RealPathFn = (path: string) => string;
export type WorkingDirectoryFn = () => string;
export type ProcessIdFn = () => number;
export type ErrorCodeFn = (error: unknown) => string | undefined;
export type GitRootFn = (cwd: string) => string | null;
export type WriteTextFn = (file: string, text: string) => void;
export type RemoveFileFn = (file: string) => void;
export type HomeDirectoryFn = () => string;
export type ImportDefaultFn = (file: string) => Promise<unknown>;
export type MessageOfFn = (error: unknown) => string;

export type Resolution =
    | { kind: 'command'; entry: CommandEntry; rest: string[] }
    | { kind: 'topic'; topic: TopicEntry; rest: string[] }
    | { kind: 'unknown'; name: string };

export type ResolveFn = (registry: Registry, argv: readonly string[]) => Resolution;

/** The flags typed before the command name, and everything from the command name on. */
export type LeadingFlags = { leading: string[]; rest: string[] };
export type SplitLeadingFlagsFn = (argv: readonly string[]) => LeadingFlags;
export type IsGlobalFlagTokenFn = (token: string) => boolean;
export type BeforeTerminatorFn = (argv: readonly string[]) => string[];
export type SuggestFn = (registry: Registry, name: string) => string | undefined;
export type FindCommandFn = (registry: Registry, id: string) => CommandEntry | undefined;

// ---------------------------------------------------------------------------------------------
// Help and the manifest
// ---------------------------------------------------------------------------------------------

export type CreateStyleFn = (enabled: boolean) => Style;

/** A name and its explanation, one line of a help table. */
export type TableRow = readonly [name: string, text: string | undefined];

/** What a help listing shows: topics and the commands under them. */
export type HelpChildren = { topics: TopicEntry[]; commands: CommandEntry[] };
export type UsageFn = (bin: string, entry: CommandEntry) => string;
export type RootHelpFn = (bin: string, registry: Registry, style: Style) => string;
export type TopicHelpFn = (
    bin: string,
    registry: Registry,
    topic: TopicEntry,
    style: Style
) => string;
export type CommandHelpFn = (bin: string, entry: CommandEntry, style: Style) => string;

export type ManifestArg = {
    name: string;
    description: string;
    required: boolean;
    default: string | null;
    choices: readonly string[] | null;
};

export type ManifestFlag = {
    name: string;
    type: FlagDefinition['type'];
    short: string | null;
    multiple: boolean;
    description: string;
    default: boolean | string | readonly string[] | null;
    choices: readonly string[] | null;
};

export type ManifestCommand = {
    id: string;
    description: string;
    usage: string;
    aliases: readonly string[];
    args: ManifestArg[];
    flags: ManifestFlag[];
    examples: readonly string[];
};

/** Everything help shows, as data: what an agent reads to know which commands exist. */
export type Manifest = {
    bin: string;
    topics: TopicEntry[];
    commands: ManifestCommand[];
    globalFlags: ManifestFlag[];
};

export type ManifestFn = (bin: string, registry: Registry) => Manifest;

// ---------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------

/** Where output goes. A node `Writable`, such as `process.stdout`, fits. */
export type OutputSink = { write: (chunk: string) => unknown; isTTY?: boolean };

export type IO = { stdout: OutputSink; stderr: OutputSink };

export type RunOptions = {
    /** Name shown in help and usage lines. Required: a library does not know what it is called. */
    bin: string;
    /** Folder to discover commands in. */
    commandsDir: string;
    stdout?: OutputSink | undefined;
    stderr?: OutputSink | undefined;
    /** Whether prompts may be shown. Default: stdin and stdout are terminals. */
    interactive?: boolean | undefined;
    /** Default: stdout is a terminal and NO_COLOR is unset. */
    color?: boolean | undefined;
    env?: NodeJS.ProcessEnv | undefined;
};

export type RunCliFn = (argv: string[], options: RunOptions) => Promise<number>;

/** What the process offers when the caller did not say: its streams, environment and terminals. */
export type SystemProcess = {
    stdout: OutputSink;
    stderr: OutputSink;
    env: NodeJS.ProcessEnv;
    stdinIsTTY: boolean;
    stdoutIsTTY: boolean;
};

export type CurrentProcessFn = () => SystemProcess;

/** What a run resolved from its options and the process, before any command is looked at. */
export type World = { io: IO; bin: string; style: Style; canPrompt: boolean };

export type ResolveWorldFn = (options: RunOptions) => World;

/** The id of the command a run is about, filled in as the command line is understood. */
export type RunState = { commandId: string | undefined };

/** Everything the steps of one run share. */
export type Session = World & {
    registry: Registry;
    wantsJson: boolean;
    state: RunState;
};

/** What help prints as text, and what it prints under --json. */
export type HelpOutput = { text: string; data: unknown };

/** An error as the user sees it. */
export type ErrorReport = {
    message: string;
    hint: string | undefined;
    usage: string | undefined;
    /** Only for a plain error, which means a bug. */
    stack: string | undefined;
    exitCode: ExitCode;
};

export type ReportContext = {
    io: IO;
    style: Style;
    json: boolean;
    commandId: string | undefined;
};

export type ReportErrorFn = (error: unknown, context: ReportContext) => number;

// ---------------------------------------------------------------------------------------------
// The shipped binary: which project it runs, and with what settings
// ---------------------------------------------------------------------------------------------

/** What a project may put under the "artemis" key of its package.json. Both fields are optional. */
export type ArtemisConfig = {
    /** Relative to the folder of that package.json. Default "commands". */
    commandsDir?: string;
    /** The name help and usage lines show. */
    bin?: string;
};

/** The folder holding the nearest package.json, and what that file says. */
export type Project = { root: string; manifest: Record<string, unknown> };

/** The settings a run uses, after defaults. `commandsDir` is absolute. */
export type CliSettings = { bin: string; commandsDir: string };

/** Reads the package.json of a folder; undefined when the folder has none. An edge. */
export type ReadManifestFn = (dir: string) => Record<string, unknown> | undefined;

/** Pure: files are read only through `readManifest`. */
export type FindProjectFn = (cwd: string, readManifest: ReadManifestFn) => Project | undefined;

/** Throws a CommandError with a hint when the "artemis" key has a bad shape. */
export type ResolveSettingsFn = (project: Project) => CliSettings;

/**
 * "artemis".bin when set; else the single key of the project's own "bin" field when it has exactly
 * one (so a project that ships `mytool` through @zjaaal/artemis/cli shows `mytool`); else "art".
 */
export type ResolveBinNameFn = (manifest: Record<string, unknown>) => string;

export type IsRecordFn = (value: unknown) => value is Record<string, unknown>;

/** What the binary reads from the machine; every field defaults to the real thing. */
export type CliOptions = {
    cwd?: string | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    stdout?: OutputSink | undefined;
    stderr?: OutputSink | undefined;
    interactive?: boolean | undefined;
    color?: boolean | undefined;
};

export type CliFn = (argv: string[], options?: CliOptions) => Promise<number>;

/** Finds the settings for a folder, or throws a CommandError that says what to create or set. */
export type SettingsForFn = (cwd: string) => CliSettings;

/** The module resolution hook that falls back to the running copy of the package. */
export type ResolveHookFn = ResolveHook;
