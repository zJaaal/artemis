import {
    ANSI_ESCAPE,
    ANSI_RESET,
    GLOBAL_FLAGS,
    BRIEF_MORE_SUFFIX,
    BRIEF_FOLD_THRESHOLD,
    BRIEF_SEARCH_SUFFIX,
    BRIEF_TOPIC_MORE_SUFFIX,
    GLOBAL_FLAGS_TEXT,
    DESTRUCTIVE_NOTE,
    DRY_RUN_NOTE,
    ID_SEPARATOR,
    NOTE_SEPARATOR,
    SECTION_SEPARATOR,
    STYLE_CODES,
    TABLE_GAP,
    TABLE_INDENT,
    USAGE_REPEAT
} from '../constants.js';
import type {
    ArgDefinition,
    BriefCommand,
    BriefManifest,
    BriefManifestFn,
    BriefTopic,
    Builtin,
    BuiltinHelpFn,
    CommandEntry,
    CommandHelpFn,
    CreateStyleFn,
    DescribeBuiltinsFn,
    FlagDefinition,
    FlagDefinitions,
    HelpChildren,
    HelpSubject,
    Manifest,
    ManifestArg,
    ManifestCommand,
    ManifestFlag,
    ManifestFn,
    TopicEntry,
    TopicManifestFn,
    Registry,
    RootHelpFn,
    StyleFn,
    Style,
    TableRow,
    TopicHelpFn,
    UsageFn
} from '../models.js';

const wrap =
    (code: number, enabled: boolean): StyleFn =>
    (text) =>
        enabled
            ? `${ANSI_ESCAPE}${code}m${String(text)}${ANSI_ESCAPE}${ANSI_RESET}m`
            : String(text);

/** Color helpers; with `enabled` false they return the text untouched. */
export const createStyle: CreateStyleFn = (enabled) => ({
    bold: wrap(STYLE_CODES.bold, enabled),
    dim: wrap(STYLE_CODES.dim, enabled),
    red: wrap(STYLE_CODES.red, enabled),
    green: wrap(STYLE_CODES.green, enabled),
    yellow: wrap(STYLE_CODES.yellow, enabled),
    cyan: wrap(STYLE_CODES.cyan, enabled)
});

const CHOICE_SEPARATOR = '|';

/** `<name>` for a required arg, `[name]` for an optional one; an arg with choices shows them instead of its name. */
const argToken = (arg: ArgDefinition): string => {
    const label = arg.choices ? arg.choices.join(CHOICE_SEPARATOR) : arg.name;

    return arg.required ? `<${label}>` : `[${label}]`;
};

/** `[--all]`, `[--older-than <value>]`, `[--mode <a|b>]`, and `...` after the bracket when repeatable. */
function flagToken(name: string, flag: FlagDefinition): string {
    const value = flag.choices ? flag.choices.join(CHOICE_SEPARATOR) : 'value';
    const body = flag.type === 'string' ? `--${name} <${value}>` : `--${name}`;

    return `[${body}]${flag.multiple ? USAGE_REPEAT : ''}`;
}

/** `uve config set [url] [--force]`: the id, then each arg, then each command flag. No bin, no global flags. */
const usageOf = (id: string, args: readonly ArgDefinition[], flags: FlagDefinitions): string =>
    [
        id,
        ...args.map(argToken),
        ...Object.entries(flags).map(([name, flag]) => flagToken(name, flag))
    ].join(ID_SEPARATOR);

export const usage: UsageFn = (entry) =>
    usageOf(entry.id, entry.definition.args, entry.definition.flags);

function table(rows: TableRow[], style: Style): string {
    const width = Math.max(0, ...rows.map(([name]) => name.length));

    return rows
        .map(
            ([name, text]) =>
                `${TABLE_INDENT}${style.green(name.padEnd(width))}${TABLE_GAP}${text ?? ''}`
        )
        .join('\n');
}

const section = (title: string, body: string, style: Style): string =>
    `${style.bold(title)}\n${body}`;

/** A description followed by its notes in parentheses, e.g. "Tags (repeatable; default: a)". */
const withNotes = (description: string | undefined, notes: string[]): string =>
    [description, notes.length ? `(${notes.join(NOTE_SEPARATOR)})` : ''].filter(Boolean).join(' ');

function flagNotes(flag: FlagDefinition): string[] {
    const notes: string[] = [];

    if (flag.multiple) {
        notes.push('repeatable');
    }

    if (flag.choices) {
        notes.push(`one of: ${flag.choices.join(', ')}`);
    }

    if (flag.default !== undefined) {
        notes.push(`default: ${String(flag.default)}`);
    }

    return notes;
}

function flagLabel(name: string, flag: FlagDefinition): string {
    const short = flag.short ? `-${flag.short}, ` : '';
    const value = flag.type === 'string' ? ' <value>' : '';

    return `${short}--${name}${value}`;
}

const flagRows = (flags: FlagDefinitions): TableRow[] =>
    Object.entries(flags).map(([name, flag]) => [
        flagLabel(name, flag),
        withNotes(flag.description, flagNotes(flag))
    ]);

function argNotes(arg: ArgDefinition): string[] {
    const notes: string[] = [];

    if (arg.required) {
        notes.push('required');
    } else if (arg.default !== undefined) {
        notes.push(`default: ${arg.default}`);
    }

    if (arg.choices) {
        notes.push(`one of: ${arg.choices.join(', ')}`);
    }

    return notes;
}

const argRows = (args: readonly ArgDefinition[]): TableRow[] =>
    args.map((arg) => [arg.name, withNotes(arg.description, argNotes(arg))]);

const globalFlagsSection = (style: Style): string =>
    section('Global flags', table(flagRows(GLOBAL_FLAGS), style), style);

const isTopLevel = (id: string): boolean => !id.includes(ID_SEPARATOR);

// The root lists top-level topics and commands; a topic lists every command under it, however
// deep, so "art uve" shows "uve config set" rather than an intermediate "uve config" topic.
function childrenOf(registry: Registry, prefix: string): HelpChildren {
    const commands = [...registry.commands.values()];

    if (!prefix) {
        return {
            topics: [...registry.topics.values()].filter((topic) => isTopLevel(topic.id)),
            commands: commands.filter((entry) => isTopLevel(entry.id))
        };
    }

    return {
        topics: [],
        commands: commands.filter((entry) => entry.id.startsWith(`${prefix}${ID_SEPARATOR}`))
    };
}

function listing(
    registry: Registry,
    prefix: string,
    style: Style,
    builtins: readonly Builtin[] = []
): string {
    const { topics, commands } = childrenOf(registry, prefix);
    const sections: string[] = [];

    if (topics.length) {
        const rows: TableRow[] = topics.map((topic) => [topic.id, topic.description]);

        sections.push(section('Topics', table(rows, style), style));
    }

    if (commands.length) {
        const rows: TableRow[] = commands.map((entry) => [entry.id, entry.definition.description]);

        sections.push(section('Commands', table(rows, style), style));
    }

    if (builtins.length) {
        const rows: TableRow[] = builtins.map((builtin) => [builtin.id, builtin.description]);

        sections.push(section('Built-in', table(rows, style), style));
    }

    sections.push(globalFlagsSection(style));

    return sections.join(SECTION_SEPARATOR);
}

export const rootHelp: RootHelpFn = (bin, registry, style, builtins) =>
    [
        `${style.bold('Usage')}  ${bin} <topic> <command> [args] [flags]`,
        listing(registry, '', style, builtins),
        style.dim(`Run "${bin} <topic>" to list a topic, or "${bin} <command> --help" for details.`)
    ].join(SECTION_SEPARATOR);

export const topicHelp: TopicHelpFn = (_bin, registry, topic, style) =>
    [
        `${style.bold(topic.id)}${topic.description ? `  ${topic.description}` : ''}`,
        listing(registry, topic.id, style)
    ].join(SECTION_SEPARATOR);

/** The help of one word: its description, usage, arguments, flags, aliases and examples. */
function subjectHelp(bin: string, subject: HelpSubject, style: Style): string {
    const { description, args, flags, aliases, examples } = subject;
    const sections = [description, `${style.bold('Usage')}  ${bin}${ID_SEPARATOR}${subject.usage}`];

    if (subject.destructive) {
        sections.push(`${style.bold('Destructive')}  ${DESTRUCTIVE_NOTE}`);
    }

    if (subject.dryRun) {
        sections.push(`${style.bold('Supports --dry-run')}  ${DRY_RUN_NOTE}`);
    }

    if (args.length) {
        sections.push(section('Arguments', table(argRows(args), style), style));
    }

    if (Object.keys(flags).length) {
        sections.push(section('Flags', table(flagRows(flags), style), style));
    }

    sections.push(globalFlagsSection(style));

    if (aliases.length) {
        sections.push(`${style.bold('Aliases')}  ${aliases.join(', ')}`);
    }

    if (examples.length) {
        const lines = examples.map((example) => `${TABLE_INDENT}${bin} ${example}`);

        sections.push(section('Examples', lines.join('\n'), style));
    }

    return sections.join(SECTION_SEPARATOR);
}

export const commandHelp: CommandHelpFn = (bin, entry, style) =>
    subjectHelp(bin, { ...entry.definition, usage: usage(entry) }, style);

/** The help of a word the binary handles itself (`init`, `state`), laid out like a command's. */
export const builtinHelp: BuiltinHelpFn = (bin, builtin, style) =>
    subjectHelp(
        bin,
        {
            ...builtin,
            aliases: []
        },
        style
    );

const describeFlags = (flags: FlagDefinitions): ManifestFlag[] =>
    Object.entries(flags).map(([name, flag]) => ({
        name,
        type: flag.type,
        ...(flag.short === undefined ? {} : { short: flag.short }),
        ...(flag.multiple ? { multiple: true as const } : {}),
        description: flag.description ?? '',
        ...(flag.default === undefined ? {} : { default: flag.default }),
        ...(flag.choices === undefined ? {} : { choices: flag.choices })
    }));

const describeArgs = (args: readonly ArgDefinition[]): ManifestArg[] =>
    args.map((arg) => ({
        name: arg.name,
        description: arg.description ?? '',
        ...(arg.required ? { required: true as const } : {}),
        ...(arg.default === undefined ? {} : { default: arg.default }),
        ...(arg.choices === undefined ? {} : { choices: arg.choices })
    }));

/** The manifest entry of a command or built-in; a key that holds its default is left out. */
const describeWord = (word: {
    id: string;
    description: string;
    usage: string;
    aliases: readonly string[];
    args: readonly ArgDefinition[];
    flags: FlagDefinitions;
    examples: readonly string[];
    destructive?: boolean | undefined;
    dryRun?: boolean | undefined;
}): ManifestCommand => ({
    id: word.id,
    description: word.description,
    usage: word.usage,
    ...(word.aliases.length ? { aliases: word.aliases } : {}),
    args: describeArgs(word.args),
    flags: describeFlags(word.flags),
    ...(word.examples.length ? { examples: word.examples } : {}),
    ...(word.destructive ? { destructive: true as const } : {}),
    ...(word.dryRun ? { dryRun: true as const } : {})
});

const describeCommand = (entry: CommandEntry): ManifestCommand =>
    describeWord({ ...entry.definition, id: entry.id, usage: usage(entry) });

/** The words of the shipped binary, described like commands so a caller reads both the same way. */
export const describeBuiltins: DescribeBuiltinsFn = (builtins) =>
    builtins.map((builtin) => describeWord({ ...builtin, aliases: [] }));

/**
 * Everything help shows, as data: what an agent reads to know which commands exist and how to call
 * them. `builtins` is only there when the binary has words of its own (the shipped `art` does).
 */
export const manifest: ManifestFn = (bin, registry, builtins): Manifest => ({
    bin,
    topics: [...registry.topics.values()],
    commands: [...registry.commands.values()].map(describeCommand),
    globalFlags: describeFlags(GLOBAL_FLAGS),
    ...(builtins === undefined ? {} : { builtins: describeBuiltins(builtins) })
});

const isWithin = (id: string, topicId: string): boolean =>
    id === topicId || id.startsWith(`${topicId}${ID_SEPARATOR}`);

/** Every topic id above a command id: `dotcms db seed` sits under `dotcms` and `dotcms db`. */
const topicPrefixes = (id: string): string[] => {
    const words = id.split(ID_SEPARATOR).slice(0, -1);

    return words.map((_, index) => words.slice(0, index + 1).join(ID_SEPARATOR));
};

const briefCommand = (command: ManifestCommand): BriefCommand => ({
    id: command.id,
    description: command.description,
    usage: command.usage,
    ...(command.destructive ? { destructive: true as const } : {}),
    ...(command.dryRun ? { dryRun: true as const } : {})
});

/** How many commands sit under each topic id, nested topics included: one pass over the commands. */
const countByTopic = (commands: readonly ManifestCommand[]): Map<string, number> => {
    const counts = new Map<string, number>();

    commands
        .flatMap((command) => topicPrefixes(command.id))
        .forEach((topicId) => counts.set(topicId, (counts.get(topicId) ?? 0) + 1));

    return counts;
};

const isTopLevelId = (id: string): boolean => !id.includes(ID_SEPARATOR);

/** The parent of a topic id: `dotcms db` sits under `dotcms`; a top-level topic has none. */
const parentOf = (id: string): string => id.split(ID_SEPARATOR).slice(0, -1).join(ID_SEPARATOR);

/** What a listing shows: which topics and which commands, and how to go one step further. */
type Shown = { topics: TopicEntry[]; commands: ManifestCommand[]; more: string };

/**
 * What the listing of a topic shows: its direct sub-topics, and every command under it at any depth.
 * It is a step down, so it is never folded.
 */
const shownForTopic = (
    everything: Manifest,
    inside: readonly ManifestCommand[],
    counts: ReadonlyMap<string, number>,
    topicId: string
): Shown => ({
    topics: everything.topics.filter(
        (topic) => counts.has(topic.id) && parentOf(topic.id) === topicId
    ),
    commands: [...inside],
    more: `${everything.bin} ${BRIEF_MORE_SUFFIX}`
});

/**
 * What the top-level listing shows. Past `BRIEF_FOLD_THRESHOLD` commands it is folded: the
 * top-level topics, and only the commands that sit in no topic. Below it, everything.
 */
const shownForTop = (everything: Manifest, counts: ReadonlyMap<string, number>): Shown => {
    const topics = everything.topics.filter((topic) => counts.has(topic.id));

    if (everything.commands.length <= BRIEF_FOLD_THRESHOLD) {
        return {
            topics,
            commands: everything.commands,
            more: `${everything.bin} ${BRIEF_MORE_SUFFIX}`
        };
    }

    return {
        topics: topics.filter((topic) => isTopLevelId(topic.id)),
        commands: everything.commands.filter((command) => isTopLevelId(command.id)),
        more: `${everything.bin} ${BRIEF_TOPIC_MORE_SUFFIX}`
    };
};

/**
 * The brief manifest: ids, one-line descriptions and how to call each (`usage`), and `destructive`
 * and `dryRun` only when true, because they are the two facts an agent must not miss before calling.
 * Topics carry the number of commands under them. A project with more than `BRIEF_FOLD_THRESHOLD`
 * commands gets a folded top level (topics, not commands); a topic listing is never folded.
 */
export const briefManifest: BriefManifestFn = (everything, topicId) => {
    const inside = everything.commands.filter(
        (command) => topicId === undefined || isWithin(command.id, topicId)
    );

    const counts = countByTopic(inside);

    const shown =
        topicId === undefined
            ? shownForTop(everything, counts)
            : shownForTopic(everything, inside, counts, topicId);

    return {
        bin: everything.bin,
        topics: shown.topics.map((topic) => ({
            id: topic.id,
            ...(topic.description ? { description: topic.description } : {}),
            commands: counts.get(topic.id) ?? 0
        })),
        commands: shown.commands.map(briefCommand),
        ...(everything.builtins === undefined || topicId !== undefined
            ? {}
            : { builtins: everything.builtins.map((builtin) => builtin.id) }),
        globalFlags: GLOBAL_FLAGS_TEXT,
        more: shown.more,
        search: `${everything.bin} ${BRIEF_SEARCH_SUFFIX}`
    };
};

/** One line per command: `id  description`, with what an agent must not miss in parentheses. */
const briefRows = (commands: BriefCommand[]): TableRow[] =>
    commands.map((command) => [
        command.id,
        withNotes(command.description, [
            ...(command.destructive ? ['destructive'] : []),
            ...(command.dryRun ? ['--dry-run'] : [])
        ])
    ]);

const topicRows = (topics: readonly BriefTopic[]): TableRow[] =>
    topics.map((topic) => [
        topic.id,
        withNotes(topic.description, [
            `${topic.commands} ${topic.commands === 1 ? 'command' : 'commands'}`
        ])
    ]);

/**
 * `help --brief` as text: the same listing as the JSON, one line per command. The built-in words
 * are ids in the JSON, so their descriptions come from `builtins`.
 */
export const briefHelp = (
    brief: BriefManifest,
    style: Style,
    builtins: readonly Builtin[] = []
): string => {
    const sections: string[] = [];

    if (brief.topics.length) {
        sections.push(section('Topics', table(topicRows(brief.topics), style), style));
    }

    if (brief.commands.length) {
        sections.push(section('Commands', table(briefRows(brief.commands), style), style));
    }

    if (brief.builtins?.length) {
        const rows: TableRow[] = builtins
            .filter((builtin) => brief.builtins?.includes(builtin.id))
            .map((builtin) => [builtin.id, builtin.description]);

        sections.push(section('Built-in', table(rows, style), style));
    }

    sections.push(style.dim(`One command in full: ${brief.more}`));

    return sections.join(SECTION_SEPARATOR);
};

/**
 * The manifest of one topic: the topic and its sub-topics, and every command under it. It keeps the
 * shape of the whole manifest, so a caller reads both the same way. The words of the binary itself
 * (`builtins`) belong to no topic, so they are not part of it.
 */
export const topicManifest: TopicManifestFn = (everything, topicId) => ({
    bin: everything.bin,
    topics: everything.topics.filter((topic) => isWithin(topic.id, topicId)),
    commands: everything.commands.filter((command) => isWithin(command.id, topicId)),
    globalFlags: everything.globalFlags
});
