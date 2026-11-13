import type { ResolveHook } from 'node:module';
import type { ParseArgsConfig } from 'node:util';

import type { AbstractPromptOptions } from '@topcli/prompts';

import type { EXIT_CODE, STYLE_CODES } from './constants.js';
import type { LockOptions } from './kits/store/models.js';
import type { CommandError, UsageError } from './errors/errors.js';

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
/** A range comparator split into its operator (`>=`, `^`, or none) and what follows it. */
export type SplitOperator = { op: string; rest: string };

export type IsNonEmptyTextFn = (value: unknown) => value is string;
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
    /** Runs another command by id or alias and returns its result. Inherits --json, --yes and --dry-run. */
    invoke: InvokeFn;
    /** `--dry-run` was passed (only ever true for a command with `dryRun: true`). */
    dryRun: boolean;
    /** Under `--dry-run`: describes one thing the command would do. A no-op otherwise. */
    plan: PlanFn;
    /** Suggests what to run after this succeeds: what follows the bin, which Artemis adds. */
    next: NextFn;
    /** `--quiet` was passed. */
    quiet: boolean;
    /** Runs a child process whose output follows `--quiet`, `--log` and `--json`. Never through a shell. */
    exec: ExecFn;
};

export type PlanFn = (step: string) => void;
/** What an agent would type after the bin (`'dotcms wait --instance x --json'`). */
export type NextFn = (...lines: string[]) => void;

/** Where output goes, and what the command was told about how it runs. */
export type ContextParts = {
    io: IO;
    global: GlobalFlags;
    interactive: boolean;
    style: Style;
    registry: Registry;
    invoke: InvokeFn;
    /** Where `ctx.plan` collects its steps: shared with the commands this one invokes. */
    plan: string[];
    /** The name help shows (`art`): put in front of every line `ctx.next` is given. */
    bin: string;
    /** Where `ctx.next` collects its lines; the caller reads them after the command succeeds. */
    next: string[];
    exec: ExecFn;
    /** The `--log` file: `ctx.log` and `ctx.warn` lines are copied into it, whatever hides them. */
    logFile: LogSink | undefined;
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
    /** Changes or deletes data the user cannot get back. It asks in a terminal and needs `--yes` otherwise. Default false. */
    destructive?: boolean;
    /** Honors `ctx.dryRun`: under `--dry-run` it reports what it would do and does none of it. Default false. */
    dryRun?: boolean;
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
    destructive: boolean;
    dryRun: boolean;
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
/** What a failed `ctx.exec` adds to a CommandError: the last lines of the child, and whether a person must be shown them. */
export type ExecErrorOptions = CommandErrorOptions & {
    tail: readonly string[];
    /** True when the child's output was hidden (`--quiet`, `capture`) and the run is not `--json`. */
    showTail: boolean;
};
export type ExecErrorShape = CommandErrorShape & { tail: readonly string[]; showTail: boolean };
export type IsExecErrorFn = (value: unknown) => value is ExecErrorShape;

export type UsageErrorOptions = { hint?: string | undefined; usage?: string | undefined };

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

export type GlobalFlags = {
    help: boolean;
    json: boolean;
    yes: boolean;
    dryRun: boolean;
    quiet: boolean;
    /** The `--log` file, as typed. */
    log: string | undefined;
};

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
/** The usage of a project command: its id, args and flags, with no bin and no global flags. */
export type UsageFn = (entry: CommandEntry) => string;
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
    destructive?: boolean;
    dryRun?: boolean;
};

/** An argument in the manifest. A key that holds its default (`required` false, no `default`, no `choices`) is left out. */
export type ManifestArg = {
    name: string;
    description: string;
    required?: true;
    default?: string;
    choices?: readonly string[];
};

/** A flag in the manifest. A key that holds its default (no `short`, `default` or `choices`, not `multiple`) is left out. */
export type ManifestFlag = {
    name: string;
    type: FlagDefinition['type'];
    short?: string;
    multiple?: true;
    description: string;
    default?: boolean | string | readonly string[];
    choices?: readonly string[];
};

/** A command in the manifest. A key that holds its default (no aliases, no examples, not destructive, no dry run) is left out. */
export type ManifestCommand = {
    id: string;
    description: string;
    usage: string;
    aliases?: readonly string[];
    args: ManifestArg[];
    flags: ManifestFlag[];
    examples?: readonly string[];
    destructive?: true;
    dryRun?: true;
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
    /** Its fixed usage line, with no bin: a built-in is not a command file, so it writes its own. */
    usage: string;
    args: readonly ArgDefinition[];
    flags: FlagDefinitions;
    examples: readonly string[];
};

/** What a call to a command says about how it will be confirmed. */
export type DestructiveCall = {
    bin: string;
    id: string;
    destructive: boolean;
    supportsDryRun: boolean;
    dryRun: boolean;
    yes: boolean;
    /** Whether anyone can answer: a terminal, and neither `--yes` nor `--json`. */
    interactive: boolean;
};

export type DestructivePlan = 'run' | 'ask' | 'refuse';
export type PlanDestructiveFn = (call: DestructiveCall) => DestructivePlan;
export type ConfirmDestructiveFn = (call: DestructiveCall) => Promise<void>;

// ---------------------------------------------------------------------------------------------
// ctx.exec
// ---------------------------------------------------------------------------------------------

export type ExecOptions = {
    cwd?: string;
    /** Default: the process environment. */
    env?: NodeJS.ProcessEnv;
    /** Return the output instead of showing it (`git rev-parse`, `docker ps`). Default false. */
    capture?: boolean;
    /** The call changes nothing, so it runs even under `--dry-run`, captured. Implies `capture`. Default false. */
    readOnly?: boolean;
    /** A non-zero exit throws. Default true. A timeout throws regardless. */
    reject?: boolean;
    /** Kills the child (SIGTERM, then SIGKILL after the grace period) and throws. Default: none. */
    timeoutMs?: number;
};

export type ExecResult = {
    /** 0 when skipped under `--dry-run`. */
    code: number;
    /** Stdout and stderr interleaved; '' when the output went to the terminal (inherit mode) or the call was skipped. */
    output: string;
    /** True under `--dry-run` for a call without `readOnly`: nothing ran. */
    skipped: boolean;
};

/** Opens the `--log` file, truncated. `cwd` is what a relative path is relative to. */
export type OpenLogFileFn = (file: string, cwd: string) => LogSink;

// ---------------------------------------------------------------------------------------------
// Version ranges (the doctor and the every-run warning)
// ---------------------------------------------------------------------------------------------

/** major, minor, patch. */
export type Version = readonly [major: number, minor: number, patch: number];

/** Whether a version is inside a range, or the range is a form the checker does not understand. */
export type RangeVerdict = 'satisfied' | 'unsatisfied' | 'not-checked';

/** One bound a version has to meet: `>= 1.2.3`, `< 2.0.0`, `= 1.2.3`. */
export type Bound = { op: '>=' | '>' | '<=' | '<' | '='; version: Version };

/** What a range body (`1`, `1.2`, `1.2.3`, `1.x`) says: the numbers given, in order. A `*` first part gives none. */
export type RangeBody = { numbers: number[] };

/** What the words after `doctor` ask for. */
export type DoctorWordsRead = { json: boolean; help: boolean; quiet: boolean };

export type ParseVersionFn = (text: string) => Version | undefined;
export type CheckRangeFn = (version: string, range: string) => RangeVerdict;

// ---------------------------------------------------------------------------------------------
// `art doctor` and the every-run version warning
// ---------------------------------------------------------------------------------------------

export type DoctorCheckId =
    'version' | 'range' | 'installed' | 'project' | 'module' | 'commands' | 'words' | 'state';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export type DoctorCheck = {
    id: DoctorCheckId;
    status: DoctorStatus;
    message: string;
    /** What to run or change; present on `warn` and `fail`. */
    fix?: string;
};

/** The copy of Artemis that is running: its version, and the folder of its package. `version` is undefined when its package.json could not be read. */
export type RunningPackage = { version: string | undefined; root: string };

/** A copy of Artemis inside a project's node_modules. */
export type LocalCopy = { version: string; root: string };

/** What the install checks need, read by edges: pure code decides from it. */
export type InstallFacts = {
    running: RunningPackage;
    /** The project's range for Artemis in `dependencies` or `devDependencies`; undefined when it has none. */
    range: string | undefined;
    /** The project's own copy, found the way Node resolves a package; undefined when there is none. */
    local: LocalCopy | undefined;
};

export type InstallCheckFn = (facts: InstallFacts) => DoctorCheck;

/** A built-in word that something of the project hides: a command file, a topic folder or an alias (of `target`). */
export type HiddenWord = { word: string; by: 'file' | 'folder' | 'alias'; target?: string };

/** What the doctor found out about the project, read by edges: the checks decide from it. */
export type DoctorFacts = {
    running: RunningPackage;
    local: LocalCopy | undefined;
    /** Undefined when no project was found from the current folder. */
    project: Project | undefined;
    /** The commands folder: whether it is there, what discovery warned about, or why the settings could not be read. */
    commands:
        | {
              dir: string;
              exists: boolean;
              warnings: readonly string[];
              problem?: string;
              /** Every alias with the id of its command, to see which one is called like a built-in word. */
              aliases?: readonly (readonly [alias: string, id: string])[];
          }
        | undefined;
    /** The built-in words a project command, topic or alias hides, and what hides each. */
    hiddenWords: readonly HiddenWord[];
    /** The state folder: whether it is there, the documents that cannot be read, or why it cannot be listed. */
    state:
        | {
              dir: string;
              exists: boolean;
              unreadable: readonly { name: string; error: string }[];
              problem?: string;
          }
        | undefined;
};

export type RunDoctorFn = (facts: DoctorFacts) => DoctorCheck[];

/** What `art doctor --json` says when something failed: the error, the first fix as the hint, and every check. */
export type DoctorFailure = { error: string; hint: string | undefined; checks: DoctorCheck[] };
export type DoctorFailureFn = (checks: readonly DoctorCheck[]) => DoctorFailure | undefined;

/** `art doctor [--quiet] [--json]`. Returns the exit code. */
export type DoctorCommandFn = (
    words: string[],
    options: CliOptions,
    cwd: string
) => Promise<number>;

/** What the skill says about the project besides its commands: the package's name and description. */
export type SkillPackage = { name: string | undefined; description: string | undefined };

/** The `SKILL.md` a manifest and a package give: short, fixed and never stale. */
export type BuildSkillFn = (manifest: Manifest, pkg: SkillPackage) => string;

/** What the words after `skill` ask for. */
export type SkillWords = {
    /** `--write <path>`: where to put the file; none prints it. */
    write: string | undefined;
    yes: boolean;
    json: boolean;
    help: boolean;
    quiet: boolean;
};

export type ParseSkillWordsFn = (words: readonly string[]) => SkillWords;

/** `art skill [--write <path>] [--yes] [--quiet] [--json]`. Returns the exit code. */
export type SkillCommandFn = (words: string[], options: CliOptions, cwd: string) => Promise<number>;

/** Reads the AGENTS.md that ships beside the running copy; undefined when it is not there. */
export type ReadAgentsFn = () => { file: string; markdown: string } | undefined;

export type ReadRunningPackageFn = () => RunningPackage;
export type FindLocalCopyFn = (projectRoot: string) => LocalCopy | undefined;

/** What the wanted range of a manifest is, if it names Artemis. */
export type RangeOfFn = (manifest: Record<string, unknown>) => string | undefined;

/** What `createExec` needs to know about the run it belongs to. */
export type ExecRun = {
    io: IO;
    global: GlobalFlags;
    log: LogSink | undefined;
    /** The children this command started that have not ended yet: killed when its `run` ends. */
    children: Set<ChildHandle>;
    /** Where a skipped call adds itself under `--dry-run`. */
    plan: string[];
    /** The folder the run was given: where a child starts, and what a relative `cwd` is relative to. */
    cwd?: string | undefined;
};

/** The `--log` file: an open file everything is copied into. */
export type LogSink = {
    /** The absolute path, as the envelope reports it. */
    path: string;
    write: (text: string) => void;
    close: () => void;
    /** Why the file could not be written (a full disk), once it failed: later text is dropped, the run goes on. */
    failure: () => string | undefined;
};

export type ExecFn = (
    command: string,
    args?: readonly string[],
    options?: ExecOptions
) => Promise<ExecResult>;

/** Which stream a piece of child output came from. */
export type ChildStream = 'stdout' | 'stderr';

/** What the spawn edge needs to start one child. Never a shell: `args` is an array. */
export type SpawnRequest = {
    command: string;
    args: readonly string[];
    cwd: string | undefined;
    env: NodeJS.ProcessEnv | undefined;
    /** Pipe stdout and stderr (stdin ignored), or inherit all three from the terminal. */
    pipe: boolean;
    timeoutMs: number | undefined;
    /** How long a child gets after SIGTERM before SIGKILL. Default: `EXEC_KILL_GRACE_MS`. */
    killGraceMs?: number;
    /** Called with each chunk of output as it arrives (piped only). */
    onData: (chunk: string, stream: ChildStream) => void;
};

/** How a child ended. */
export type SpawnOutcome = {
    code: number;
    timedOut: boolean;
    /** The executable could not be started (ENOENT). */
    notFound: boolean;
    /** The folder to run in does not exist: Node reports it with the same ENOENT as a missing program. */
    cwdMissing: boolean;
    /** The caller ended it (`stop`, when the run ended), as opposed to the timeout: not a failure. */
    stopped: boolean;
    /** Why it could not start, when the cause is neither a missing program nor a missing folder (permissions, say). */
    startError: string | undefined;
    /** The signal that ended it (an OOM kill, a crash), when it had no exit code. */
    signal: string | undefined;
};

/** What a child's end is built from: the exit code, and why it did not run or how it was ended when that applies. */
export type SpawnFinish = Pick<SpawnOutcome, 'code' | 'notFound' | 'cwdMissing'> & {
    startError?: string | undefined;
    signal?: string | undefined;
};

export type ChildHandle = {
    done: Promise<SpawnOutcome>;
    /** SIGTERM, then SIGKILL after the grace period; resolves when the child is gone. */
    stop: () => Promise<void>;
};

export type SpawnChildFn = (request: SpawnRequest) => ChildHandle;

/** How `ctx.exec` runs a child, decided from the flags of the run and the options of the call. */
export type ExecMode = {
    pipe: boolean;
    /** Where piped output is shown: nowhere, split like the child's own streams, or all on stderr. */
    echo: 'none' | 'split' | 'stderr';
    /** Whether the last lines are kept for `tail`. */
    keep: boolean;
};

export type ExecModeInput = { capture: boolean; quiet: boolean; json: boolean; log: boolean };
export type PickExecModeFn = (input: ExecModeInput) => ExecMode;

/** The last lines of a child's output, each cut: what a failed command's envelope carries as `tail`. */
export type TailRing = {
    push: (stream: ChildStream, chunk: string) => void;
    /** Closes the lines still being written and returns the last ones. */
    lines: () => string[];
};

export type CreateTailFn = (maxLines: number, maxChars: number) => TailRing;

/** One line of the brief manifest: what an agent needs before it calls. `destructive` and `dryRun` only when true. */
export type BriefCommand = {
    id: string;
    description: string;
    destructive?: true;
    dryRun?: true;
};

export type BriefTopic = { id: string; description: string };

/** `help --json --brief`: ids and one-line descriptions, and how to get one command in full. */
export type BriefManifest = {
    bin: string;
    topics: BriefTopic[];
    commands: BriefCommand[];
    /** Only on the shipped binary, as in the full manifest. Never marked destructive. */
    builtins?: { id: string; description: string }[];
    more: string;
};

/** The brief manifest of everything, or of one topic when `topicId` is given. */
export type BriefManifestFn = (everything: Manifest, topicId?: string) => BriefManifest;

export type DescribeBuiltinsFn = (builtins: readonly Builtin[]) => ManifestCommand[];

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
    /** The folder a relative `--log` path is resolved against. Default: the current folder of the process. */
    cwd?: string | undefined;
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

export type World = Environment & { bin: string; cwd?: string | undefined };

export type ResolveWorldFn = (options: HostOptions) => Environment;

/** The id of the command a run is about, filled in as the command line is understood. */
export type RunState = { commandId: string | undefined };

/** What one run collects across the commands it invokes: the dry-run plan. */
export type RunScope = {
    plan: string[];
    /** The `--log` file, once opened: every line a command and its children print is copied here. */
    log?: LogSink | undefined;
};

/** What running a command gives back: its result, and the lines it suggested to run next. */
export type Executed = { result: unknown; next: string[] };

/** Everything the steps of one run share. */
export type Session = World & {
    registry: Registry;
    wantsJson: boolean;
    state: RunState;
    builtins: readonly Builtin[] | undefined;
    scope: RunScope;
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
    /** The last lines of a failed child, when `ctx.exec` made this error. */
    tail: readonly string[] | undefined;
    showTail: boolean;
    exitCode: ExitCode;
};

export type ReportContext = {
    io: IO;
    style: Style;
    json: boolean;
    commandId: string | undefined;
    /** The name usage lines show. Only `run()` sets it: a usage line is printed with the bin in front when it is. */
    bin?: string | undefined;
    /** The absolute path of the `--log` file, when one was opened. */
    log?: string | undefined;
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
/** What a folder's project says: the settings to run with, and the project they came from. */
export type FoundSettings = { settings: CliSettings; project: Project };
export type SettingsForFn = (start: string, route: CliRoute) => FoundSettings;

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

/** What `<word> --help` prints for a built-in word: its usage text, or under --json its manifest entry. */
export type WordHelpFn = (word: { id: string; text: string; json: boolean }) => string;

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
    /** `--quiet`: hides the warnings of the word. */
    quiet: boolean;
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

/** Refuses a flag typed before `state` that is not a global one (a UsageError). */
/** What a built-in word prints when it succeeds: the envelope under `--json`, the text otherwise. */
export type PrintResultFn = (
    io: IO,
    print: {
        json: boolean;
        command: string | null;
        text: string;
        result: unknown;
        /** The envelope keys after `result`, already in their fixed order. */
        extras?: Record<string, unknown>;
    }
) => void;

/** The failure envelope as one line of JSON: `ok`, `command`, `error`, then `hint`, `log`, `tail` and `checks` when there are any. */
export type FailureEnvelopeFn = (
    command: string | null,
    error: string,
    keys?: {
        hint?: string | undefined;
        log?: string | undefined;
        tail?: readonly string[] | undefined;
        checks?: readonly DoctorCheck[] | undefined;
    }
) => string;

/** The success envelope as one line of JSON: `ok`, `command`, `result`, then `extras` in the order given. */
export type SuccessEnvelopeFn = (
    command: string | null,
    result: unknown,
    extras?: Record<string, unknown>
) => string;

export type AssertLeadingFlagsFn = (leading: readonly string[], word: string) => void;

/** A word the shipped binary runs itself: it gets the command line without the word, and the folder it runs in. */
export type ShippedWord = {
    word: string;
    run: (words: string[], host: HostOptions, cwd: string) => number | Promise<number>;
};

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
/** What in the commands folder hides a word of the binary: a command file, a topic folder, or nothing. */
export type ShadowKindFn = (commandsDir: string, word: string) => 'file' | 'folder' | undefined;
export type IsFlagTokenFn = (token: string) => boolean;
export type FlagWithoutCommandFn = (
    flag: string,
    bin: string | undefined,
    subject?: string
) => UsageError;
