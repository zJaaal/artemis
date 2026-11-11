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

type FlagValue<TFlag extends FlagDefinition> = TFlag extends { readonly type: 'boolean' }
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

export type DefineTopicFn = (definition?: TopicDefinition) => Topic;
export type IsCommandFn = (value: unknown) => value is Command;
export type IsTopicFn = (value: unknown) => value is Topic;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

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
export type ImportDefaultFn = (file: string) => Promise<unknown>;
export type MessageOfFn = (error: unknown) => string;

export type Resolution =
    | { kind: 'command'; entry: CommandEntry; rest: string[] }
    | { kind: 'topic'; topic: TopicEntry; rest: string[] }
    | { kind: 'unknown'; name: string };

export type ResolveFn = (registry: Registry, argv: readonly string[]) => Resolution;
export type SuggestFn = (registry: Registry, name: string) => string | undefined;
export type FindCommandFn = (registry: Registry, id: string) => CommandEntry | undefined;

// ---------------------------------------------------------------------------------------------
// Help and the manifest
// ---------------------------------------------------------------------------------------------

export type CreateStyleFn = (enabled: boolean) => Style;
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

export type RunOptions = {
    /** Name shown in help and usage lines. Required: a library does not know what it is called. */
    bin: string;
    /** Folder to discover commands in. */
    commandsDir: string;
    stdout?: OutputSink;
    stderr?: OutputSink;
    /** Whether prompts may be shown. Default: stdin and stdout are terminals. */
    interactive?: boolean;
    /** Default: stdout is a terminal and NO_COLOR is unset. */
    color?: boolean;
    env?: NodeJS.ProcessEnv;
};

export type RunCliFn = (argv: string[], options: RunOptions) => Promise<number>;
