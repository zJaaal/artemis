import { createContext } from './context.js';
import {
    DEFAULT_COLOR_ENV,
    EXIT_CODE,
    FLAG_PREFIX,
    HELP_WORD,
    ID_SEPARATOR,
    JSON_FLAG
} from './constants.js';
import { discover } from './discover.js';
import { currentProcess } from './edges/process.js';
import { CommandError, UsageError } from './errors.js';
import { commandHelp, createStyle, manifest, rootHelp, topicHelp, usage } from './help.js';
import type {
    CommandEntry,
    GlobalFlags,
    HelpOutput,
    InvokeFn,
    ParsedCommandLine,
    Registry,
    ResolveWorldFn,
    Resolution,
    RunCliFn,
    RunState,
    Session
} from './models.js';
import { parse } from './parse.js';
import { reportError } from './report.js';
import { findCommand, resolve, suggest } from './resolve.js';

const isFlagToken = (token: string): boolean => token.startsWith(FLAG_PREFIX);

/** Works out where output goes, whether to color and whether prompts may show. */
const resolveWorld: ResolveWorldFn = (options) => {
    const system = currentProcess();
    const io = { stdout: options.stdout ?? system.stdout, stderr: options.stderr ?? system.stderr };
    const env = options.env ?? system.env;
    const color = options.color ?? (Boolean(io.stdout.isTTY) && !env[DEFAULT_COLOR_ENV]);
    const canPrompt = options.interactive ?? (system.stdinIsTTY && system.stdoutIsTTY);

    return { io, bin: options.bin, style: createStyle(color), canPrompt };
};

/** Prints text, or under --json the data wrapped in the success envelope. */
function print(session: Session, text: string, data: unknown): void {
    const output = session.wantsJson
        ? JSON.stringify({ ok: true, command: session.state.commandId ?? null, result: data })
        : text;

    session.io.stdout.write(`${output}\n`);
}

const unknownHint = (bin: string, registry: Registry, name: string): string => {
    const match = suggest(registry, name);

    if (match) {
        return `Did you mean "${match}"?`;
    }

    // Inside a topic, point at that topic's list rather than the whole CLI
    const topic = name.split(ID_SEPARATOR).slice(0, -1).join(ID_SEPARATOR);
    const listing = registry.topics.has(topic) ? `${bin} ${topic} help` : `${bin} help`;

    return `Run "${listing}" to see the commands.`;
};

const unknownCommand = ({ bin, registry }: Session, name: string): UsageError =>
    new UsageError(`Unknown command "${name}".`, { hint: unknownHint(bin, registry, name) });

/** `ctx.invoke`: runs another command, which inherits --json and --yes from the caller. */
const createInvoke =
    (session: Session, caller: GlobalFlags): InvokeFn =>
    async (id, argv = []) => {
        const target = findCommand(session.registry, id);

        if (!target) {
            throw new CommandError(`ctx.invoke: there is no command "${id}"`);
        }

        const nested = parse(target.definition, argv, usage(session.bin, target));

        const global = {
            ...nested.global,
            json: nested.global.json || caller.json,
            yes: nested.global.yes || caller.yes
        };

        return execute(session, target, { ...nested, global });
    };

async function execute(
    session: Session,
    entry: CommandEntry,
    parsed: ParsedCommandLine
): Promise<unknown> {
    const ctx = createContext({
        io: session.io,
        global: parsed.global,
        interactive: session.canPrompt && !parsed.global.yes,
        style: session.style,
        registry: session.registry,
        invoke: createInvoke(session, parsed.global)
    });

    return entry.definition.run({ args: parsed.args, flags: parsed.flags, ctx });
}

/** The text and the --json data for something that was resolved. */
function helpFor(session: Session, target: Exclude<Resolution, { kind: 'unknown' }>): HelpOutput {
    const { bin, registry, style } = session;
    const everything = manifest(bin, registry);

    if (target.kind === 'topic') {
        return { text: topicHelp(bin, registry, target.topic, style), data: everything };
    }

    return {
        text: commandHelp(bin, target.entry, style),
        data: everything.commands.find((command) => command.id === target.entry.id)
    };
}

function showHelpFor(session: Session, words: string[]): void {
    if (!words.length) {
        session.state.commandId = HELP_WORD;

        print(
            session,
            rootHelp(session.bin, session.registry, session.style),
            manifest(session.bin, session.registry)
        );

        return;
    }

    const target = resolve(session.registry, words);

    if (target.kind === 'unknown') {
        throw unknownCommand(session, target.name);
    }

    session.state.commandId = target.kind === 'command' ? target.entry.id : target.topic.id;

    const { text, data } = helpFor(session, target);

    print(session, text, data);
}

/** Works out what the command line asks for and does it. */
async function dispatch(session: Session, argv: string[]): Promise<number> {
    const words = argv.filter((token) => !isFlagToken(token));
    const wantsHelp = !words.length || argv[0] === HELP_WORD;

    if (wantsHelp) {
        showHelpFor(session, argv[0] === HELP_WORD ? words.slice(1) : []);

        return EXIT_CODE.OK;
    }

    const target = resolve(session.registry, argv);

    if (target.kind === 'unknown') {
        throw unknownCommand(session, target.name);
    }

    if (target.kind === 'topic') {
        showHelpFor(session, target.topic.id.split(ID_SEPARATOR));

        return EXIT_CODE.OK;
    }

    session.state.commandId = target.entry.id;

    const parsed = parse(target.entry.definition, target.rest, usage(session.bin, target.entry));

    if (parsed.global.help) {
        showHelpFor(session, target.entry.id.split(ID_SEPARATOR));

        return EXIT_CODE.OK;
    }

    const result = await execute(session, target.entry, parsed);

    if (session.wantsJson) {
        print(session, '', result ?? null);
    }

    return EXIT_CODE.OK;
}

/**
 * Runs a command line and resolves to the exit code; it never calls process.exit, so it can be
 * embedded and tested. Exit codes: 0 success, 1 the command failed, 2 the command line was wrong.
 * With --json every call prints one object on stdout: `{ ok: true, command, result }` or
 * `{ ok: false, command, error, hint }`.
 */
export const run: RunCliFn = async (argv, options) => {
    const world = resolveWorld(options);
    const wantsJson = argv.includes(JSON_FLAG);
    const state: RunState = { commandId: undefined };

    try {
        const registry = await discover(options.commandsDir);

        registry.warnings.forEach((warning) =>
            world.io.stderr.write(`${world.style.yellow('warning:')} ${warning}\n`)
        );

        return await dispatch({ ...world, registry, wantsJson, state }, argv);
    } catch (error) {
        return reportError(error, {
            io: world.io,
            style: world.style,
            json: wantsJson,
            commandId: state.commandId
        });
    }
};
