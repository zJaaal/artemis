import { createContext } from '../context/context.js';
import { createExec } from '../context/run-exec.js';
import { readAgents } from '../edges/agents-file.js';
import { appendAuditLine } from '../edges/audit-file.js';
import { now } from '../edges/clock.js';
import { openLogFile } from '../edges/log-file.js';
import { workingDirectory } from '../edges/system.js';
import {
    AGENTS_FILE,
    AGENTS_FLAG,
    BRIEF_FLAG,
    DRY_RUN_FLAG,
    EXIT_CODE,
    HELP_WORD,
    ID_SEPARATOR,
    LOG_FLAG,
    PACKAGE_NAME,
    NEXT_PREFIX,
    DRY_RUN_EMPTY,
    DRY_RUN_HEADER,
    TABLE_INDENT,
    AUDIT_WRITE_WARNING,
    UNKNOWN_COMMAND_MAX_IDS,
    BRIEF_LISTING_FLAGS,
    AGENTS_ADDING_HEADING,
    AGENTS_CALLING_HEADING,
    AGENTS_RUNNING_HEADING,
    AUTHORING_FLAG,
    SECTION_JOINER,
    SEARCH_CLASH_FLAGS,
    SEARCH_EXAMPLE,
    SEARCH_FLAG
} from '../constants.js';
import { buildAuditLine } from '../audit/audit.js';
import { discover } from '../discover/discover.js';
import { markdownSection } from '../help/markdown.js';
import { readSearch, wordsOf } from '../help/search.js';
import { CommandError, UsageError, isUsageError } from '../errors/errors.js';
import {
    briefHelp,
    briefManifest,
    builtinHelp,
    commandHelp,
    describeBuiltins,
    manifest,
    rootHelp,
    searchResult,
    searchText,
    topicHelp,
    topicManifest,
    usage
} from '../help/help.js';
import type {
    AuditEdges,
    Builtin,
    ChildHandle,
    CommandEntry,
    Executed,
    GlobalFlags,
    HelpOutput,
    InvokeFn,
    ParsedCommandLine,
    SearchRead,
    Registry,
    Resolution,
    RunCliFn,
    RunOptions,
    RunScope,
    RunState,
    Session,
    World
} from '../models.js';
import { parse } from '../parse/parse.js';
import { confirmDestructive } from './destructive.js';
import { reportError } from './report.js';
import { resolveWorld } from './world.js';
import {
    findCommand,
    findStrayLeading,
    hasLogFlag,
    resolve,
    splitLeadingFlags,
    suggest
} from '../resolve/resolve.js';
import { printResult } from './report.js';
import { messageOf } from '../utils/error-message.js';
import { flagWithoutCommand } from '../utils/flag-without-command.js';
import { beforeTerminator, jsonRequested, quietRequested } from '../utils/terminator.js';

/** What `printResult` takes for this run: text, or under --json the data wrapped in the success envelope. */
const shown = (
    session: Session,
    text: string,
    result: unknown,
    extras: Record<string, unknown> = {}
) => ({
    json: session.wantsJson,
    command: session.state.commandId ?? null,
    text,
    result,
    extras
});

/** The ids that share a word with what was typed, the first few by id order. */
function idsSharingAWord(registry: Registry, name: string): string[] {
    // Only the word that was not found: the topic before it is right, and shares a word with every command in it
    const typed = new Set(wordsOf(name.split(ID_SEPARATOR).slice(-1).join(ID_SEPARATOR)));

    return [...registry.commands.keys()]
        .filter((id) => wordsOf(id).some((word) => typed.has(word)))
        .sort()
        .slice(0, UNKNOWN_COMMAND_MAX_IDS);
}

const unknownHint = (
    bin: string,
    registry: Registry,
    name: string,
    builtins: readonly Builtin[] = []
): string => {
    const match = suggest(
        registry,
        name,
        builtins.map((builtin) => builtin.id)
    );

    if (match) {
        return `Did you mean "${match}"?`;
    }

    const sharing = idsSharingAWord(registry, name);

    if (sharing.length) {
        return `Did you mean one of: ${sharing.map((id) => `"${id}"`).join(', ')}?`;
    }

    // Inside a topic, point at that topic's list rather than the whole CLI
    const topic = name.split(ID_SEPARATOR).slice(0, -1).join(ID_SEPARATOR);

    const listing = registry.topics.has(topic)
        ? `${bin} help ${topic} ${BRIEF_LISTING_FLAGS}`
        : `${bin} help ${BRIEF_LISTING_FLAGS}`;

    return `Run "${listing}" to see the commands.`;
};

const unknownCommand = ({ bin, registry, builtins }: Session, name: string): UsageError =>
    new UsageError(`Unknown command "${name}".`, {
        hint: unknownHint(bin, registry, name, builtins)
    });

/** The word of the binary itself that these help words name, if any: `help state`. */
const builtinNamed = ({ builtins = [] }: Session, words: string[]): Builtin | undefined =>
    words.length === 1 ? builtins.find((builtin) => builtin.id === words[0]) : undefined;

/** A bad call to `ctx.invoke` is the calling command's bug, not a wrong command line: exit 1. */
function parseNested(
    session: Session,
    target: CommandEntry,
    id: string,
    argv: string[]
): ParsedCommandLine {
    try {
        const nested = parse(target.definition, argv, usage(target));

        if (nested.global.help) {
            throw new CommandError(
                `ctx.invoke("${id}"): --help is not something a command can invoke`,
                {
                    hint: `Call it with its arguments, or read its help with "${session.bin} help ${id}".`
                }
            );
        }

        return nested;
    } catch (error) {
        if (!isUsageError(error)) {
            throw error;
        }

        throw new CommandError(`ctx.invoke("${id}"): ${error.message}`, {
            hint: error.usage ? `Usage: ${session.bin} ${error.usage}` : error.hint,
            cause: error
        });
    }
}

/** `--dry-run` asked of a command that does not say it honors it: nothing may run by surprise. */
const lacksDryRun = (entry: CommandEntry, global: GlobalFlags): boolean =>
    global.dryRun && !entry.definition.dryRun;

const noDryRunMessage = (entry: CommandEntry): string => `${entry.id} does not support --dry-run`;

/** `ctx.invoke`: runs another command, which inherits --json and --yes from the caller. */
const createInvoke =
    (session: Session, caller: GlobalFlags): InvokeFn =>
    async (id, argv = []) => {
        const target = findCommand(session.registry, id);

        if (!target) {
            throw new CommandError(`ctx.invoke: there is no command "${id}"`);
        }

        const nested = parseNested(session, target, id, argv);

        if (nested.global.log !== undefined) {
            throw new CommandError(
                `ctx.invoke("${id}"): --log is not something a command can invoke`,
                {
                    hint: 'An invoked command writes into the log of the run that called it. Pass --log to the command line instead.'
                }
            );
        }

        const global = {
            ...nested.global,
            json: nested.global.json || caller.json,
            yes: nested.global.yes || caller.yes,
            dryRun: nested.global.dryRun || caller.dryRun,
            quiet: nested.global.quiet || caller.quiet,
            log: caller.log
        };

        if (lacksDryRun(target, global)) {
            throw new CommandError(`ctx.invoke("${id}"): ${noDryRunMessage(target)}`, {
                hint: 'Check ctx.dryRun before invoking it, or read what it needs with ctx.exec(..., { readOnly: true }).'
            });
        }

        // What the invoked command suggests is discarded: the caller decides what comes next
        return (await execute(session, target, { ...nested, global })).result;
    };

/** Opens the `--log` file the first time a command of the run asks for it. An invoked command writes into the same one. */
function openLogOnce(session: Session, global: GlobalFlags): void {
    if (global.log !== undefined && session.scope.log === undefined) {
        session.scope.log = openLogFile(global.log, session.cwd ?? workingDirectory());
    }
}

/** --json promises exactly one object on stdout, so nothing may prompt there either. */
const canAsk = (session: Session, global: GlobalFlags): boolean =>
    session.canPrompt && !global.yes && !global.json;

async function execute(
    session: Session,
    entry: CommandEntry,
    parsed: ParsedCommandLine
): Promise<Executed> {
    await confirmDestructive({
        bin: session.bin,
        id: entry.id,
        destructive: entry.definition.destructive,
        supportsDryRun: entry.definition.dryRun,
        dryRun: parsed.global.dryRun,
        yes: parsed.global.yes,
        interactive: canAsk(session, parsed.global)
    });

    // Step 5 of the order: after the confirmation, so a declined run leaves a kept log as it was
    openLogOnce(session, parsed.global);

    const next: string[] = [];
    const children = new Set<ChildHandle>();

    const exec = createExec({
        io: session.io,
        global: parsed.global,
        log: session.scope.log,
        children,
        plan: session.scope.plan,
        cwd: session.cwd
    });

    const ctx = createContext({
        io: session.io,
        global: parsed.global,
        interactive: canAsk(session, parsed.global),
        style: session.style,
        registry: session.registry,
        invoke: createInvoke(session, parsed.global),
        plan: session.scope.plan,
        bin: session.bin,
        next,
        exec,
        logFile: session.scope.log
    });

    try {
        // From here on the command is running: a refused or declined confirmation never got this far
        session.state.audit.ran = true;

        const result = await entry.definition.run({ args: parsed.args, flags: parsed.flags, ctx });

        return { result, next };
    } finally {
        // A child a command left running does not outlive it, and is gone before the envelope prints
        await Promise.all([...children].map((child) => child.stop()));
    }
}

/** The text and the --json data for something that was resolved. */
function helpFor(session: Session, target: Exclude<Resolution, { kind: 'unknown' }>): HelpOutput {
    const { bin, registry, style } = session;
    const everything = manifest(bin, registry);

    if (target.kind === 'topic') {
        return {
            text: topicHelp(bin, registry, target.topic, style),
            data: topicManifest(everything, target.topic.id)
        };
    }

    return {
        text: commandHelp(bin, target.entry, style),
        data: everything.commands.find((command) => command.id === target.entry.id)
    };
}

/** `help --brief`: ids and one-line descriptions of everything, or of one topic. One command is not a listing. */
function showBriefFor(session: Session, words: string[]): void {
    const { bin, registry, style, builtins } = session;
    const everything = manifest(bin, registry, builtins);

    if (!words.length) {
        session.state.commandId = HELP_WORD;

        const brief = briefManifest(everything);

        printResult(session.io, shown(session, briefHelp(brief, style, builtins), brief));

        return;
    }

    const target = builtinNamed(session, words) ? undefined : resolve(registry, words);

    if (target?.kind === 'unknown') {
        throw unknownCommand(session, target.name);
    }

    if (target?.kind !== 'topic') {
        throw new UsageError(
            `--brief lists commands; drop it to see ${words.join(ID_SEPARATOR)} in full`,
            {
                hint: `Run "${bin} help ${words.join(ID_SEPARATOR)} --json" for the whole entry.`
            }
        );
    }

    session.state.commandId = target.topic.id;

    const brief = briefManifest(everything, target.topic.id);

    printResult(session.io, shown(session, briefHelp(brief, style, builtins), brief));
}

/**
 * `help --agents` and `help --authoring`: parts of the AGENTS.md of the running copy. `--agents` is
 * the calling contract and points at `--authoring`; `--authoring` is how to write a command and how
 * to set a project up. It reads the running copy and never the project's, so it works with a global
 * `art` and no local install. It documents Artemis, not the tool, so a published tool's CLI has it
 * too. Neither takes a topic or command, and they do not go with each other, `--brief` or `--search`.
 */
function showAgentsDoc(session: Session, words: string[], rest: string[]): void {
    const flag = rest.includes(AGENTS_FLAG) ? AGENTS_FLAG : AUTHORING_FLAG;
    const other = flag === AGENTS_FLAG ? AUTHORING_FLAG : AGENTS_FLAG;
    const clash = [other, BRIEF_FLAG].find((token) => beforeTerminator(rest).includes(token));
    const subject = clash ?? (words.length ? 'topic or command' : undefined);

    if (subject !== undefined) {
        throw new UsageError(`${flag} takes no ${subject}`, {
            hint: `Run "${session.bin} help ${flag}" on its own.`
        });
    }

    const agents = readAgents();

    if (agents === undefined) {
        throw new CommandError(`${AGENTS_FILE} is missing from this install of ${PACKAGE_NAME}`, {
            hint: `Reinstall ${PACKAGE_NAME}.`
        });
    }

    const headings =
        flag === AGENTS_FLAG
            ? [AGENTS_CALLING_HEADING]
            : [AGENTS_ADDING_HEADING, AGENTS_RUNNING_HEADING];

    const sections = headings.map((heading) => markdownSection(agents.markdown, heading));
    const missing = headings.find((_, index) => sections[index] === undefined);

    if (missing !== undefined) {
        throw new CommandError(`${AGENTS_FILE} has no "${missing}" section`, {
            hint: `Reinstall ${PACKAGE_NAME}.`
        });
    }

    const body = sections.join(SECTION_JOINER);

    const markdown =
        flag === AGENTS_FLAG
            ? `${body}${SECTION_JOINER}To write a command or set up a project: ${session.bin} help ${AUTHORING_FLAG}`
            : body;

    session.state.commandId = HELP_WORD;

    printResult(session.io, shown(session, markdown, { file: agents.file, markdown }));
}

/** The flags of `help` that mean something else than a search, and cannot go with one. */
const flagsClashingWith = (tokens: readonly string[]): string[] =>
    SEARCH_CLASH_FLAGS.filter((flag) => beforeTerminator(tokens).includes(flag));

/**
 * `help --search <words>`: the best few commands for an intent, in the whole project or inside one
 * topic. Builtins are never searched. It is help, so it never changes the exit code but for a wrong
 * command line.
 */
function showSearch(session: Session, searched: SearchRead, rest: string[]): void {
    const { bin, registry, style } = session;
    const [clash] = flagsClashingWith(rest);

    if (clash !== undefined) {
        throw new UsageError(`${SEARCH_FLAG} cannot go with ${clash}`, {
            hint: `Run "${bin} help ${SEARCH_FLAG} <words>" on its own, or "${bin} help ${clash}" without a search.`
        });
    }

    const { query, words } = searched;

    if (query === undefined) {
        throw new UsageError(`${SEARCH_FLAG} needs the words to search for`, {
            hint: `Quote them: ${bin} help ${SEARCH_FLAG} "${SEARCH_EXAMPLE}" --json`
        });
    }

    if (!wordsOf(query).length) {
        throw new UsageError(`Nothing to search for in "${query}"`, {
            hint: `Search with words from what the command does, for example: ${bin} help ${SEARCH_FLAG} "${SEARCH_EXAMPLE}" --json`
        });
    }

    const topicId = searchScope(session, words);
    const result = searchResult(manifest(bin, registry), query, topicId);

    session.state.commandId = HELP_WORD;

    printResult(session.io, shown(session, searchText(result, bin, style), result));
}

/** The topic a search is limited to: none for the whole project; a command or a built-in is not a scope. */
function searchScope(session: Session, words: string[]): string | undefined {
    if (!words.length) {
        return undefined;
    }

    const named = words.join(ID_SEPARATOR);

    if (builtinNamed(session, words)) {
        throw new UsageError(`${SEARCH_FLAG} does not search the built-in word ${named}`, {
            hint: `Built-in words are listed by "${session.bin} help ${BRIEF_FLAG} --json".`
        });
    }

    const target = resolve(session.registry, words);

    if (target.kind === 'unknown') {
        throw unknownCommand(session, target.name);
    }

    if (target.kind === 'command') {
        throw new UsageError(
            `${SEARCH_FLAG} searches the project or a topic, and ${named} is a command`,
            {
                hint: `Run "${session.bin} help ${named} --json" for the whole entry.`
            }
        );
    }

    return target.topic.id;
}

function showHelpFor(session: Session, words: string[]): void {
    if (!words.length) {
        session.state.commandId = HELP_WORD;

        printResult(
            session.io,
            shown(
                session,
                rootHelp(session.bin, session.registry, session.style, session.builtins),
                manifest(session.bin, session.registry, session.builtins)
            )
        );

        return;
    }

    const builtin = builtinNamed(session, words);

    if (builtin) {
        session.state.commandId = builtin.id;

        printResult(
            session.io,
            shown(
                session,
                builtinHelp(session.bin, builtin, session.style),
                describeBuiltins([builtin])[0]
            )
        );

        return;
    }

    const target = resolve(session.registry, words);

    if (target.kind === 'unknown') {
        throw unknownCommand(session, target.name);
    }

    session.state.commandId = target.kind === 'command' ? target.entry.id : target.topic.id;

    const { text, data } = helpFor(session, target);

    printResult(session.io, shown(session, text, data));
}

/** The help word takes neither `--log` nor `--dry-run`: it runs nothing, so there is nothing to log or plan. */
function assertHelpFlags(session: Session, leading: string[], rest: string[]): void {
    // After `--` everything is a plain argument, here as everywhere else
    const tokens = beforeTerminator([...leading, ...rest]);
    const refused = hasLogFlag(tokens) ? LOG_FLAG : tokens.find((token) => token === DRY_RUN_FLAG);

    if (refused !== undefined) {
        const subject = rest[0] === HELP_WORD ? `${HELP_WORD} does not take` : undefined;

        throw flagWithoutCommand(refused, session.bin, subject);
    }
}

/** The envelope keys after `result`, in their fixed order: dryRun, plan, next. */
const successExtras = (
    session: Session,
    global: GlobalFlags,
    next: readonly string[]
): Record<string, unknown> => ({
    ...(global.dryRun ? { dryRun: true, plan: session.scope.plan } : {}),
    ...(next.length ? { next } : {}),
    ...(session.scope.log ? { log: session.scope.log.path } : {})
});

/** The plan of a dry run as text: what would happen, or that nothing would. */
const planText = (plan: readonly string[]): string =>
    plan.length
        ? [DRY_RUN_HEADER, ...plan.map((step) => `${TABLE_INDENT}- ${step}`)].join('\n')
        : DRY_RUN_EMPTY;

/** Works out what the command line asks for and does it. */
async function dispatch(session: Session, argv: string[]): Promise<number> {
    const { leading, rest } = splitLeadingFlags(argv);
    const stray = findStrayLeading(leading);

    if (stray) {
        throw new UsageError(`Unknown option "${stray}"`, {
            hint: `Flags go after the command: ${session.bin} <command> ${stray}`
        });
    }

    const [first] = rest;

    if (first === undefined || first === HELP_WORD) {
        assertHelpFlags(session, leading, rest);

        const searched = readSearch(rest.slice(1));
        const helpWords = searched.words;

        if (searched.present) {
            showSearch(session, searched, rest);
        } else if (rest.includes(AGENTS_FLAG) || rest.includes(AUTHORING_FLAG)) {
            showAgentsDoc(session, helpWords, rest);
        } else if (rest.includes(BRIEF_FLAG)) {
            showBriefFor(session, helpWords);
        } else {
            showHelpFor(session, helpWords);
        }

        return EXIT_CODE.OK;
    }

    const target = resolve(session.registry, rest);

    if (target.kind === 'unknown') {
        throw unknownCommand(session, target.name);
    }

    if (target.kind === 'topic') {
        // A topic runs nothing, so a log or a plan asked of it would silently never exist
        assertHelpFlags(session, leading, rest);
        showHelpFor(session, target.topic.id.split(ID_SEPARATOR));

        return EXIT_CODE.OK;
    }

    session.state.commandId = target.entry.id;
    session.state.audit.tokens = [...leading, ...target.rest];
    session.state.audit.recordable = true;

    const parsed = parse(
        target.entry.definition,
        [...leading, ...target.rest],
        usage(target.entry)
    );

    if (parsed.global.help) {
        // Reading the help of a command is not running it
        session.state.audit.recordable = false;
        showHelpFor(session, target.entry.id.split(ID_SEPARATOR));

        return EXIT_CODE.OK;
    }

    if (lacksDryRun(target.entry, parsed.global)) {
        throw new UsageError(noDryRunMessage(target.entry), {
            usage: usage(target.entry),
            hint: `Drop --dry-run, or read "${session.bin} help ${target.entry.id}" for what it supports.`
        });
    }

    const { result, next } = await execute(session, target.entry, parsed);

    if (session.wantsJson) {
        printResult(
            session.io,
            shown(session, '', result ?? null, successExtras(session, parsed.global, next))
        );
    } else if (parsed.global.dryRun) {
        session.io.stdout.write(`${planText(session.scope.plan)}\n`);
    }

    if (!session.wantsJson && !parsed.global.quiet) {
        next.forEach((line) => session.io.stderr.write(`${NEXT_PREFIX} ${line}\n`));
    }

    return EXIT_CODE.OK;
}

/** The append and the clock of a run: the real ones, unless a test gave others. */
const auditEdgesOf = (options: RunOptions): AuditEdges => ({
    append: appendAuditLine,
    now,
    ...options.audit
});

/**
 * Writes the audit line of a run, the last thing it does: after the result is printed and the log
 * is closed, so a slow disk never delays it. It records a resolved project command only, and only
 * when `run()` was given a file. A failed write is a warning, never a change of the result.
 */
function recordAudit(
    options: RunOptions,
    world: World,
    state: RunState,
    outcome: {
        startedAt: number;
        code: number;
        error: unknown;
        plan: readonly string[];
        quiet: boolean;
    }
): void {
    const { commandId, audit } = state;

    if (options.auditFile === undefined || !audit.recordable || commandId === undefined) {
        return;
    }

    const edges = auditEdgesOf(options);

    const line = buildAuditLine({
        commandId,
        draft: audit,
        startedAt: outcome.startedAt,
        endedAt: edges.now(),
        exitCode: outcome.code,
        plan: outcome.plan,
        error: outcome.error === undefined ? undefined : messageOf(outcome.error)
    });

    try {
        edges.append(options.auditFile, JSON.stringify(line));
    } catch (error) {
        if (!outcome.quiet) {
            world.io.stderr.write(
                `${world.style.yellow('warning:')} ${AUDIT_WRITE_WARNING} ${options.auditFile}: ${messageOf(error)}\n`
            );
        }
    }
}

/**
 * Runs a command line and resolves to the exit code; it never calls process.exit, so it can be
 * embedded and tested. Exit codes: 0 success, 1 the command failed, 2 the command line was wrong.
 * With --json every call prints one object on stdout: `{ ok: true, command, result }` or
 * `{ ok: false, command, error, hint }`.
 */
export const run: RunCliFn = async (argv, options) => {
    const world: World = { ...resolveWorld(options), bin: options.bin, cwd: options.cwd };
    const wantsJson = jsonRequested(argv);

    const state: RunState = {
        commandId: undefined,
        audit: { recordable: false, tokens: [], ran: false }
    };

    const scope: RunScope = { plan: [] };
    const startedAt = auditEdgesOf(options).now();
    let code: number = EXIT_CODE.FAILED;
    let failed: unknown;

    try {
        const registry = await discover(options.commandsDir);

        if (!quietRequested(argv)) {
            registry.warnings.forEach((warning) =>
                world.io.stderr.write(`${world.style.yellow('warning:')} ${warning}\n`)
            );
        }

        code = await dispatch(
            { ...world, registry, wantsJson, state, builtins: options.builtins, scope },
            argv
        );

        return code;
    } catch (error) {
        failed = error;

        code = reportError(error, {
            io: world.io,
            style: world.style,
            json: wantsJson,
            commandId: state.commandId,
            bin: options.bin,
            log: scope.log?.path
        });

        return code;
    } finally {
        scope.log?.close();

        // The result of the run stands; only the missing part of the log is reported
        if (scope.log?.failure() !== undefined) {
            world.io.stderr.write(
                `${world.style.yellow('warning:')} the log file ${scope.log.path} is incomplete: ${scope.log.failure()}\n`
            );
        }

        recordAudit(options, world, state, {
            startedAt,
            code,
            error: failed,
            plan: scope.plan,
            quiet: quietRequested(argv)
        });
    }
};
