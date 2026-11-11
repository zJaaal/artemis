import {
    ANSI_ESCAPE,
    ANSI_RESET,
    GLOBAL_FLAGS,
    ID_SEPARATOR,
    NOTE_SEPARATOR,
    SECTION_SEPARATOR,
    STYLE_CODES,
    TABLE_GAP,
    TABLE_INDENT
} from '../constants.js';
import type {
    ArgDefinition,
    CommandEntry,
    CommandHelpFn,
    CreateStyleFn,
    FlagDefinition,
    FlagDefinitions,
    HelpChildren,
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
export const usage: UsageFn = (bin, entry) => {
    const { args, flags } = entry.definition;
    const parts = [bin, entry.id, ...args.map(argToken)];

    if (Object.keys(flags).length > 0) {
        parts.push('[flags]');
    }

    return parts.join(ID_SEPARATOR);
};

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

function listing(registry: Registry, prefix: string, style: Style): string {
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

    sections.push(globalFlagsSection(style));

    return sections.join(SECTION_SEPARATOR);
}

export const rootHelp: RootHelpFn = (bin, registry, style) =>
    [
        `${style.bold('Usage')}  ${bin} <topic> <command> [args] [flags]`,
        listing(registry, '', style),
        style.dim(`Run "${bin} <topic>" to list a topic, or "${bin} <command> --help" for details.`)
    ].join(SECTION_SEPARATOR);

export const topicHelp: TopicHelpFn = (_bin, registry, topic, style) =>
    [
        `${style.bold(topic.id)}${topic.description ? `  ${topic.description}` : ''}`,
        listing(registry, topic.id, style)
    ].join(SECTION_SEPARATOR);

export const commandHelp: CommandHelpFn = (bin, entry, style) => {
    const { description, args, flags, aliases, examples } = entry.definition;
    const sections = [description, `${style.bold('Usage')}  ${usage(bin, entry)}`];

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
};

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
    examples: entry.definition.examples
});

/** Everything help shows, as data: what an agent reads to know which commands exist and how to call them. */
export const manifest: ManifestFn = (bin, registry): Manifest => ({
    bin,
    topics: [...registry.topics.values()],
    commands: [...registry.commands.values()].map((entry) => describeCommand(bin, entry)),
    globalFlags: describeFlags(GLOBAL_FLAGS)
});

const isWithin = (id: string, topicId: string): boolean =>
    id === topicId || id.startsWith(`${topicId} `);

/**
 * The manifest of one topic: the topic and its sub-topics, and every command under it. It keeps the
 * shape of the whole manifest, so a caller reads both the same way.
 */
export const topicManifest: TopicManifestFn = (everything, topicId) => ({
    ...everything,
    topics: everything.topics.filter((topic) => isWithin(topic.id, topicId)),
    commands: everything.commands.filter((command) => isWithin(command.id, topicId))
});
