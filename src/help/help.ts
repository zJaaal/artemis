import {
    ANSI_ESCAPE,
    ANSI_RESET,
    GLOBAL_FLAGS,
    BRIEF_MORE_SUFFIX,
    DESTRUCTIVE_NOTE,
    DRY_RUN_NOTE,
    ID_SEPARATOR,
    NOTE_SEPARATOR,
    SECTION_SEPARATOR,
    STYLE_CODES,
    TABLE_GAP,
    TABLE_INDENT
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

const argToken = (arg: ArgDefinition): string => (arg.required ? `<${arg.name}>` : `[${arg.name}]`);

/** `art uve config set [url] [flags]` */
const usageOf = (
    bin: string,
    id: string,
    args: readonly ArgDefinition[],
    flags: FlagDefinitions
): string => {
    const parts = [bin, id, ...args.map(argToken)];

    if (Object.keys(flags).length > 0) {
        parts.push('[flags]');
    }

    return parts.join(ID_SEPARATOR);
};

export const usage: UsageFn = (bin, entry) =>
    usageOf(bin, entry.id, entry.definition.args, entry.definition.flags);

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
    const sections = [description, `${style.bold('Usage')}  ${subject.usage}`];

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
    subjectHelp(bin, { ...entry.definition, usage: usage(bin, entry) }, style);

/** The help of a word the binary handles itself (`init`, `state`), laid out like a command's. */
export const builtinHelp: BuiltinHelpFn = (bin, builtin, style) =>
    subjectHelp(
        bin,
        {
            ...builtin,
            usage: usageOf(bin, builtin.id, builtin.args, builtin.flags),
            aliases: []
        },
        style
    );

const describeFlags = (flags: FlagDefinitions): ManifestFlag[] =>
    Object.entries(flags).map(([name, flag]) => ({
        name,
        type: flag.type,
        short: flag.short ?? null,
        multiple: Boolean(flag.multiple),
        description: flag.description ?? '',
        default: flag.default ?? null,
        choices: flag.choices ?? null
    }));

const describeArgs = (args: readonly ArgDefinition[]): ManifestArg[] =>
    args.map((arg) => ({
        name: arg.name,
        description: arg.description ?? '',
        required: Boolean(arg.required),
        default: arg.default ?? null,
        choices: arg.choices ?? null
    }));

const describeCommand = (bin: string, entry: CommandEntry): ManifestCommand => ({
    id: entry.id,
    description: entry.definition.description,
    usage: usage(bin, entry),
    aliases: entry.definition.aliases,
    args: describeArgs(entry.definition.args),
    flags: describeFlags(entry.definition.flags),
    examples: entry.definition.examples,
    destructive: entry.definition.destructive,
    dryRun: entry.definition.dryRun
});

/** The words of the shipped binary, described like commands so a caller reads both the same way. */
export const describeBuiltins: DescribeBuiltinsFn = (bin, builtins) =>
    builtins.map((builtin) => ({
        id: builtin.id,
        description: builtin.description,
        usage: usageOf(bin, builtin.id, builtin.args, builtin.flags),
        aliases: [],
        args: describeArgs(builtin.args),
        flags: describeFlags(builtin.flags),
        examples: builtin.examples,
        destructive: false,
        dryRun: false
    }));

/**
 * Everything help shows, as data: what an agent reads to know which commands exist and how to call
 * them. `builtins` is only there when the binary has words of its own (the shipped `art` does).
 */
export const manifest: ManifestFn = (bin, registry, builtins): Manifest => ({
    bin,
    topics: [...registry.topics.values()],
    commands: [...registry.commands.values()].map((entry) => describeCommand(bin, entry)),
    globalFlags: describeFlags(GLOBAL_FLAGS),
    ...(builtins === undefined ? {} : { builtins: describeBuiltins(bin, builtins) })
});

const isWithin = (id: string, topicId: string): boolean =>
    id === topicId || id.startsWith(`${topicId}${ID_SEPARATOR}`);

/** Every topic id above a command id: `dotcms db seed` sits under `dotcms` and `dotcms db`. */
const topicPrefixes = (id: string): string[] => {
    const words = id.split(ID_SEPARATOR).slice(0, -1);

    return words.map((_, index) => words.slice(0, index + 1).join(ID_SEPARATOR));
};

const briefCommand = (command: Manifest['commands'][number]): BriefCommand => ({
    id: command.id,
    description: command.description,
    ...(command.destructive ? { destructive: true as const } : {}),
    ...(command.dryRun ? { dryRun: true as const } : {})
});

/**
 * The brief manifest: ids and one-line descriptions, and `destructive` and `dryRun` only when true,
 * because they are the two facts an agent must not miss before calling. Topics are listed at any
 * depth, by full id, when they hold a command of the listing.
 */
export const briefManifest: BriefManifestFn = (everything, topicId) => {
    const commands = everything.commands.filter(
        (command) => topicId === undefined || isWithin(command.id, topicId)
    );

    const withCommands = new Set(commands.flatMap((command) => topicPrefixes(command.id)));

    const topics: BriefTopic[] = everything.topics
        .filter((topic) => withCommands.has(topic.id))
        .map((topic) => ({ id: topic.id, description: topic.description }));

    return {
        bin: everything.bin,
        topics,
        commands: commands.map(briefCommand),
        ...(everything.builtins === undefined || topicId !== undefined
            ? {}
            : {
                  builtins: everything.builtins.map(({ id, description }) => ({ id, description }))
              }),
        more: `${everything.bin} ${BRIEF_MORE_SUFFIX}`
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

/** `help --brief` as text: the same listing as the JSON, one line per command. */
export const briefHelp = (brief: BriefManifest, style: Style): string => {
    const sections: string[] = [];

    if (brief.topics.length) {
        sections.push(
            section(
                'Topics',
                table(
                    brief.topics.map((topic) => [topic.id, topic.description]),
                    style
                ),
                style
            )
        );
    }

    if (brief.commands.length) {
        sections.push(section('Commands', table(briefRows(brief.commands), style), style));
    }

    if (brief.builtins?.length) {
        const rows: TableRow[] = brief.builtins.map((builtin) => [builtin.id, builtin.description]);

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
