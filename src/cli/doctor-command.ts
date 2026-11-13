import path from 'node:path';

import { AUDIT_FILE_NAME, EXIT_CODE, JSON_EXTENSION, NEWLINE } from '../constants.js';
import { parseAuditText } from '../audit/audit.js';
import { now } from '../edges/clock.js';
import { discover } from '../discover/discover.js';
import {
    isFolder,
    listJsonFiles,
    pathExists,
    readManifest,
    readTextIfExists
} from '../edges/files.js';
import { shadowKind } from './shadow.js';
import { findLocalCopy, readRunningPackage } from '../edges/package-info.js';
import { CommandError, UsageError } from '../errors/errors.js';
import { isValidDocName } from '../kits/store/names.js';
import { inspectDocument } from '../kits/store/raw.js';
import type {
    DoctorCheck,
    DoctorCommandFn,
    DoctorFacts,
    DoctorHistory,
    DoctorWordsRead,
    HiddenWord,
    Project,
    Style
} from '../models.js';
import { failureEnvelope, reportError, successEnvelope } from '../run/report.js';
import { resolveWorld } from '../run/world.js';
import { messageOf } from '../utils/error-message.js';
import {
    DOCTOR_FLAGS,
    DOCTOR_HELP,
    DOCTOR_USAGE_LINE,
    DOCTOR_WORD,
    WORD_NAMES,
    DOCTOR_FIX_INDENT,
    DOCTOR_ID_WIDTH,
    DOCTOR_STATUS_LABEL
} from './constants.js';
import { doctorFailure, runDoctor } from './doctor.js';
import { findProject, resolveSettings, resolveStateDir } from './settings.js';
import { wordHelp } from './word-help.js';

const KNOWN_WORDS: readonly string[] = Object.values(DOCTOR_FLAGS);

function readWords(words: readonly string[]): DoctorWordsRead {
    const unexpected = words.find((word) => !KNOWN_WORDS.includes(word));

    if (unexpected !== undefined) {
        throw new UsageError(`${DOCTOR_WORD} takes no arguments, but got "${unexpected}"`, {
            usage: DOCTOR_USAGE_LINE,
            hint: `${DOCTOR_WORD} takes --quiet, --json and --help.`
        });
    }

    return {
        json: words.includes(DOCTOR_FLAGS.json),
        help: words.includes(DOCTOR_FLAGS.help) || words.includes(DOCTOR_FLAGS.helpShort),
        quiet: words.includes(DOCTOR_FLAGS.quiet)
    };
}

/** The commands folder as discovery sees it. A bad "artemis" key is reported as the problem, not thrown. */
async function readCommands(project: Project): Promise<DoctorFacts['commands']> {
    try {
        const { commandsDir } = resolveSettings(project, 'shipped');

        if (!isFolder(commandsDir)) {
            return { dir: commandsDir, exists: false, warnings: [] };
        }

        const registry = await discover(commandsDir);

        return {
            dir: commandsDir,
            exists: true,
            warnings: registry.warnings,
            aliases: [...registry.aliases.entries()],
            loaded: [...registry.commands.values()].map((entry) => ({
                id: entry.id,
                destructive: entry.definition.destructive
            }))
        };
    } catch (error) {
        return { dir: '', exists: false, warnings: [], problem: messageOf(error) };
    }
}

/** What hides a built-in word, if anything: a command file, a topic folder, or an alias of a command. */
function hiding(
    commands: NonNullable<DoctorFacts['commands']>,
    word: string
): HiddenWord | undefined {
    const by = shadowKind(commands.dir, word);

    if (by !== undefined) {
        return { word, by };
    }

    const target = commands.aliases?.find(([alias]) => alias === word)?.[1];

    return target === undefined ? undefined : { word, by: 'alias', target };
}

/** The built-in words a command, topic or alias of the project hides. */
function readHiddenWords(commands: DoctorFacts['commands']): HiddenWord[] {
    return commands?.exists ? WORD_NAMES.flatMap((word) => hiding(commands, word) ?? []) : [];
}

/** The documents of the state folder, and the ones that cannot be read. */
function readState(project: Project): DoctorFacts['state'] {
    try {
        const dir = resolveStateDir(project);

        if (!pathExists(dir)) {
            return { dir, exists: false, unreadable: [] };
        }

        const unreadable = listJsonFiles(dir)
            .map((file) => path.basename(file, JSON_EXTENSION))
            .filter(isValidDocName)
            .flatMap((name) => {
                const found = inspectDocument(path.join(dir, `${name}${JSON_EXTENSION}`));

                return 'error' in found ? [{ name, error: found.error }] : [];
            });

        return { dir, exists: true, unreadable };
    } catch (error) {
        return { dir: '', exists: false, unreadable: [], problem: messageOf(error) };
    }
}

/** The audit trail: its lines in file order, or why it could not be read. A line that is not one is not a problem here. */
function readHistory(project: Project): DoctorHistory {
    try {
        const text = readTextIfExists(path.join(resolveStateDir(project), AUDIT_FILE_NAME));

        return text === undefined
            ? { present: false, entries: [] }
            : { present: true, entries: parseAuditText(text).entries };
    } catch (error) {
        return {
            present: true,
            entries: [],
            problem: `Cannot read the audit trail: ${messageOf(error)}`
        };
    }
}

/** Reads everything the checks need. A package.json that cannot be parsed is an error naming the file, as everywhere else. */
async function gatherFacts(cwd: string, clock: () => number): Promise<DoctorFacts> {
    const running = readRunningPackage();
    const project = findProject(cwd, readManifest, isFolder, 'shipped');
    const local = findLocalCopy(project?.root ?? cwd);

    if (project === undefined) {
        return {
            running,
            local,
            project,
            commands: undefined,
            hiddenWords: [],
            state: undefined,
            history: undefined,
            now: clock()
        };
    }

    const commands = await readCommands(project);

    return {
        running,
        local,
        project,
        commands,
        hiddenWords: readHiddenWords(commands),
        state: readState(project),
        history: readHistory(project),
        now: clock()
    };
}

const checkLine = (check: DoctorCheck, style: Style): string => {
    const paint = { ok: style.green, warn: style.yellow, fail: style.red }[check.status];

    // A fix with several lines (one per command) keeps each on its own indented line
    const fix = check.fix
        ? `\n${DOCTOR_FIX_INDENT}fix: ${check.fix.split(NEWLINE).join(`${NEWLINE}${DOCTOR_FIX_INDENT}`)}`
        : '';

    return `${paint(DOCTOR_STATUS_LABEL[check.status])}  ${check.id.padEnd(DOCTOR_ID_WIDTH)} ${check.message}${fix}`;
};

/**
 * `doctor [--quiet] [--json]`: checks the install and the project and gives a fix for each problem.
 * Handled by the shipped binary itself, like `init` and `state`, so it works where there is no
 * project: the `project` check then fails. Exit 0 with warnings only, 1 when a check fails; a
 * failing run keeps its checks in the `checks` key of the envelope.
 */
export const doctorCommand: DoctorCommandFn = async (words, options, cwd) => {
    const read = readWords(words);
    const { io, style } = resolveWorld(options);

    if (read.help) {
        io.stdout.write(`${wordHelp({ id: DOCTOR_WORD, text: DOCTOR_HELP, json: read.json })}\n`);

        return EXIT_CODE.OK;
    }

    const facts = await gatherFacts(cwd, options.audit?.now ?? now);
    const checks = runDoctor(facts);
    const failure = doctorFailure(checks);

    if (read.json) {
        const envelope = failure
            ? failureEnvelope(DOCTOR_WORD, failure.error, {
                  hint: failure.hint,
                  checks: failure.checks
              })
            : successEnvelope(DOCTOR_WORD, { version: facts.running.version ?? null, checks });

        io.stdout.write(`${envelope}\n`);

        return failure ? EXIT_CODE.FAILED : EXIT_CODE.OK;
    }

    io.stdout.write(`${checks.map((check) => checkLine(check, style)).join('\n')}\n`);

    return failure
        ? reportError(new CommandError(failure.error, { hint: failure.hint }), {
              io,
              style,
              json: false,
              commandId: DOCTOR_WORD
          })
        : EXIT_CODE.OK;
};
