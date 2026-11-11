import type { ResolveHook } from 'node:module';
import type { ParseArgsConfig } from 'node:util';

import type { AbstractPromptOptions } from '@topcli/prompts';

import type { EXIT_CODE, STYLE_CODES } from './constants.js';
import type { LockOptions } from './kits/store/models.js';
import type { CommandError } from './errors/errors.js';

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
export type InvokeFn = (id: string, argv?: string[]) => Promise<unknown>;

// ---------------------------------------------------------------------------------------------
// ctx.prompt: Artemis's own types, so no question format of a library is promised. Values are
// strings because the library returns strings, and a CLI answer is text anyway.
// ---------------------------------------------------------------------------------------------

/** The hint of the error thrown when nobody can answer. */
/** Whether a question can be asked, and whether `--yes` or `--json` is why it cannot. */
export type PrompterMode = { interactive: boolean; flagsSkipQuestions: boolean };
export type PromptOptions = { hint?: string };
export type ConfirmOptions = PromptOptions & { initial?: boolean };
export type TextOptions = PromptOptions & { initial?: string };
export type Choice<TValue extends string> = {
    label: string;
    value: TValue;
    description?: string;
};
export type SelectOptions<TValue extends string> = PromptOptions & {
    choices: readonly Choice<TValue>[];
};
export type MultiselectOptions<TValue extends string> = PromptOptions & {
    choices: readonly (Choice<TValue> & { selected?: boolean })[];
};

/** `ctx.prompt`: four questions that return the answer itself. */
export type Prompter = {
    /** Yes or no. `initial` is what pressing Return answers; default false. */
    confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
    /** Free text. `initial` is returned when the user just presses Return. */
    text: (message: string, options?: TextOptions) => Promise<string>;
    /** One of the choices, by its `value`. */
    select: <const TValue extends string>(
        message: string,
        options: SelectOptions<TValue>
    ) => Promise<TValue>;
    /** Any number of the choices, by their `value`s. */
    multiselect: <const TValue extends string>(
        message: string,
        options: MultiselectOptions<TValue>
    ) => Promise<TValue[]>;
};

/** One question as the edge receives it, before it is mapped onto the library. */
export type Question =
    | { kind: 'confirm'; message: string; options: ConfirmOptions }
    | { kind: 'text'; message: string; options: TextOptions }
    | { kind: 'select'; message: string; options: SelectOptions<string> }
    | { kind: 'multiselect'; message: string; options: MultiselectOptions<string> };

/** The terminal a question is asked on: stdin to read keys from, stdout to draw on. */
export type PromptStreams = {
    stdin: NonNullable<AbstractPromptOptions['stdin']>;
    stdout: NonNullable<AbstractPromptOptions['stdout']>;
};

/** Asks one question of the library with these streams and signal; resolves with the raw answer. */
export type AskFn = (
    question: Question,
    streams: PromptStreams,
    signal: AbortSignal
) => Promise<unknown>;

/** What came of a question: the answer, or the user gave up (Ctrl+C). */
export type PromptOutcome = { kind: 'answered'; answer: unknown } | { kind: 'cancelled' };

/** Asks a question on the terminal, and reports Ctrl+C as a cancellation. */
export type AskQuestionFn = (question: Question, streams?: PromptStreams) => Promise<PromptOutcome>;

export type IsAbortFn = (error: unknown) => boolean;
export type IsBooleanFn = (value: unknown) => value is boolean;
export type IsTextFn = (value: unknown) => value is string;
export type IsTextListFn = (value: unknown) => value is string[];

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
    prompt: Prompter;
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

/** Whether a value carries a `Symbol.for` tag (a definition's, or an error's), which survives two copies of the package. */
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
export type RenameFileFn = (from: string, to: string) => void;
/** Replaces a file with this text so that nobody ever reads it half written. */
export type WriteAtomicFn = (file: string, text: string) => void;
/** The `*.json` files of a folder, by name: never a temporary file or a lock. A missing folder has none. */
export type ListJsonFilesFn = (dir: string) => string[];
export type HomeDirectoryFn = () => string;
export type ImportDefaultFn = (file: string) => Promise<unknown>;
export type IsThenableFn = (value: unknown) => value is PromiseLike<unknown>;
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
export type JsonRequestedFn = (argv: readonly string[]) => boolean;
/** The exit code of a failure: the one a tagged error carries when it is a failure code, else 1. */
export type FailureCodeOfFn = (value: unknown) => ExitCode;
/** `extraNames` are words the registry does not know but a caller may mean (the binary's built-ins). */
export type SuggestFn = (
    registry: Registry,
    name: string,
    extraNames?: readonly string[]
) => string | undefined;
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
export type RootHelpFn = (
    bin: string,
    registry: Registry,
    style: Style,
    builtins?: readonly Builtin[]
) => string;
export type TopicHelpFn = (
    bin: string,
    registry: Registry,
    topic: TopicEntry,
    style: Style
) => string;
export type CommandHelpFn = (bin: string, entry: CommandEntry, style: Style) => string;
export type BuiltinHelpFn = (bin: string, builtin: Builtin, style: Style) => string;
/** One word of a binary, as help prints it: a command file's entry and a built-in both fit. */
export type HelpSubject = {
    description: string;
    usage: string;
    args: readonly ArgDefinition[];
    flags: FlagDefinitions;
    aliases: readonly string[];
    examples: readonly string[];
};

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
    /** The words the shipped binary handles itself (`init`, `state`). Absent on a published tool's CLI. */
    builtins?: ManifestCommand[];
};

/** A word of the shipped binary that is not a command file: what help needs to list and describe it. */
export type Builtin = {
    id: string;
    description: string;
    args: readonly ArgDefinition[];
    flags: FlagDefinitions;
    examples: readonly string[];
};

export type DescribeBuiltinsFn = (bin: string, builtins: readonly Builtin[]) => ManifestCommand[];

export type ManifestFn = (
    bin: string,
    registry: Registry,
    builtins?: readonly Builtin[]
) => Manifest;

/** The manifest narrowed to one topic: the topic and its sub-topics, and every command under it. Same shape. */
export type TopicManifestFn = (everything: Manifest, topicId: string) => Manifest;

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
    /** Words the binary handles itself, listed by help. The shipped `art` passes `init` and `state`; a tool passes none. */
    builtins?: readonly Builtin[] | undefined;
};

export type RunCliFn = (argv: string[], options: RunOptions) => Promise<number>;

/** What the process offers when the caller did not say: its streams, environment and terminals. */
export type SystemProcess = {
    stdout: OutputSink;
    stderr: OutputSink;
    env: NodeJS.ProcessEnv;
    /** The command line, without the node and script words. */
    args: string[];
    stdinIsTTY: boolean;
    stdoutIsTTY: boolean;
};

export type CurrentProcessFn = () => SystemProcess;

/** The options that describe the host a run happens in; `run()` and `cli()` both take them. */
export type HostOptions = Pick<RunOptions, 'stdout' | 'stderr' | 'interactive' | 'color' | 'env'>;

/** What a run resolved from the host options and the process, before any command is looked at. */
export type Environment = { io: IO; style: Style; canPrompt: boolean };

export type World = Environment & { bin: string };

export type ResolveWorldFn = (options: HostOptions) => Environment;

/** The id of the command a run is about, filled in as the command line is understood. */
export type RunState = { commandId: string | undefined };

/** Everything the steps of one run share. */
export type Session = World & {
    registry: Registry;
    wantsJson: boolean;
    state: RunState;
    builtins: readonly Builtin[] | undefined;
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
    /** Where the store kit keeps its documents, relative to the folder of that package.json. Default "state". Read by `art state` and `defineStore({ project })`. */
    stateDir?: string;
};

/** The folder holding the nearest qualifying package.json, and what that file says. */
export type Project = { root: string; manifest: Record<string, unknown> };

/** How a run got started: the shipped binary (`art`, `artemis`) or a project's own bin file. */
export type CliRoute = 'shipped' | 'own';

/** The settings a run uses, after defaults. `commandsDir` is absolute. */
export type CliSettings = { bin: string; commandsDir: string };

/** What a folder's package.json says: an object, or the error of a file that cannot be read or parsed. */
export type ManifestRead =
    { manifest: Record<string, unknown>; text: string } | { error: CommandError };

/**
 * Reads the package.json of a folder; undefined when the folder has none. An edge. It never throws
 * for a bad file: it returns the error, and the search decides what to do with it.
 */
export type ReadManifestFn = (dir: string) => ManifestRead | undefined;

/**
 * Which package.json is the project, from positive signals only (nothing is inferred about what a
 * file is not). Shipped route: the nearest one with an "artemis" key (declared, usually by `init`) or
 * a commands folder next to it. Own route (`cli({ root })`): the nearest one with the identity of a
 * package (a name, a `bin` or an "artemis" key), and never past the folder of an installed package,
 * so a published tool cannot climb into the project that installed it. Markers and templates carry
 * none of these signals. A package.json that cannot be read or parsed is an error, never skipped.
 * Pure: the disk is only looked at through `readManifest` and `isFolder`.
 */
export type FindProjectFn = (
    start: string,
    readManifest: ReadManifestFn,
    isFolder: IsFolderFn,
    route: CliRoute
) => Project | undefined;

/** The folder the store kit keeps its documents in (absolute). Throws a CommandError when the "artemis" key has a bad shape. */
export type ResolveStateDirFn = (project: Project) => string;

/** What to say when no project is found from a folder upwards. */
export type NoProjectErrorFn = (start: string, route: CliRoute) => CommandError;

/** Throws a CommandError with a hint when the "artemis" key has a bad shape. */
export type ResolveSettingsFn = (project: Project, route: CliRoute) => CliSettings;

/**
 * The name help and usage lines show. Both routes use the checked `"artemis".bin` first. The shipped
 * binary then shows `art`, never the name of an unrelated CLI the project publishes. A project's own
 * bin file (`cli({ root })`) shows the single key of its `bin` object, or the package name without
 * its scope when `bin` is a string (npm names the command that way), and falls back to `art`.
 */
export type ResolveBinNameFn = (
    config: ArtemisConfig,
    manifest: Record<string, unknown>,
    route: CliRoute
) => string;

export type IsRecordFn = (value: unknown) => value is Record<string, unknown>;

/** What `cli()` takes: the host options of `run()`, plus where to look for the project. */
export type CliOptions = HostOptions & {
    /** The command line, without the node and script words. Default: the arguments of this process. */
    argv?: string[] | undefined;
    /** Shipped route: where to start looking. Default: the current folder. */
    cwd?: string | undefined;
    /** Own route: where the bin file is (`import.meta.url`). The search starts from its folder. */
    root?: string | URL | undefined;
};

export type CliFn = (options?: CliOptions) => Promise<number>;

/** Finds the settings for a folder, or throws a CommandError that says what to create or set. */
export type SettingsForFn = (start: string, route: CliRoute) => CliSettings;

/** The folder a `root` points at: itself when it is a folder, else the folder of the file. */
export type FolderOfRootFn = (root: string | URL) => string;

/** The module resolution hook that falls back to the running copy of the package. */
export type ResolveHookFn = ResolveHook;

// ---------------------------------------------------------------------------------------------
// `init`: making a folder a project
// ---------------------------------------------------------------------------------------------

/** What `init` needs to know about a folder; an edge reads it from the disk. */
export type InitInput = {
    dir: string;
    /** The text of the package.json, or undefined when there is none. */
    manifestText: string | undefined;
    manifest: Record<string, unknown> | undefined;
    /** Where the commands go: the configured folder, or `commands`. Absolute. */
    commandsDir: string;
    commandsDirExists: boolean;
    commandsDirIsEmpty: boolean;
    /** Whether a command or topic named `init` is already there, which the `init` word would hide. */
    shadowsCommand: boolean;
};

/** One thing `init` does. It never overwrites a file that exists. */
export type InitStep =
    | { kind: 'folder'; path: string }
    /** `create` fails if the file appears in the meantime; `update` is the one deliberate rewrite, of package.json. */
    | { kind: 'file'; mode: 'create' | 'update'; path: string; text: string };

export type InitPlan = {
    steps: InitStep[];
    /** What was already there and is left alone. */
    kept: string[];
    warnings: string[];
};

/** Pure: decides what to create, from what the folder already has. */
export type PlanInitFn = (input: InitInput) => InitPlan;

export type InitResult = { root: string; created: string[]; kept: string[]; warnings: string[] };

/** Reads the folder, plans, and does it. Throws a CommandError for a package.json it cannot use. */
export type InitProjectFn = (dir: string) => InitResult;

export type DetectIndentFn = (text: string) => string;
/** The text of a JSON object with one more property at the end, and nothing else changed. */
export type AddKeyFn = (text: string, key: string, valueText: string) => string;
export type IsInstalledPackageRootFn = (dir: string) => boolean;
export type PackageNameForFn = (dir: string) => string;

/** `art init [folder] [--json]`. Returns the exit code. */
export type InitCommandFn = (words: string[], options: CliOptions, cwd: string) => number;

// ---------------------------------------------------------------------------------------------
// `art state`
// ---------------------------------------------------------------------------------------------

/** What the words after `state` ask for. */
export type StateWords = {
    /** The document to show or reset; none lists them all. */
    name: string | undefined;
    reset: boolean;
    yes: boolean;
    json: boolean;
    help: boolean;
};

export type ParseStateWordsFn = (words: readonly string[]) => StateWords;

/** What a state call needs to decide: its words, whether anyone can answer, and which documents exist. */
export type StateInput = {
    words: StateWords;
    interactive: boolean;
    existing: readonly string[];
};

/** What to do. `ask` says a reset needs the person to confirm first. */
export type StatePlan =
    | { kind: 'list' }
    | { kind: 'show'; name: string }
    | { kind: 'unknown'; name: string }
    | { kind: 'reset'; name: string; ask: boolean }
    | { kind: 'cannot-ask'; name: string };

export type PlanStateFn = (input: StateInput) => StatePlan;

/** What `art state` is given besides the words: how its lock waits, so a test never sleeps. */
export type StateEdges = { lock: LockOptions };

/** `art state [<doc>] [--reset] [--yes] [--json]`. Returns the exit code. */
export type StateCommandFn = (
    words: string[],
    host: CliOptions,
    cwd: string,
    edges?: StateEdges
) => Promise<number>;

/** What every step of a state call shares: where output goes, which folder, and how it was asked. */
export type StateRun = {
    io: IO;
    /** The state folder, absolute. */
    dir: string;
    cwd: string;
    json: boolean;
    interactive: boolean;
    /** The names of the documents in the folder. */
    existing: readonly string[];
    lock: LockOptions;
};

export type ShadowsWordFn = (commandsDir: string, word: string) => boolean;
