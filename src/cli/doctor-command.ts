import path from 'node:path';

import { EXIT_CODE, JSON_EXTENSION } from '../constants.js';
import { discover } from '../discover/discover.js';
import { isFolder, listJsonFiles, pathExists, readManifest } from '../edges/files.js';
import { findLocalCopy, readRunningPackage } from '../edges/package-info.js';
import { CommandError, UsageError } from '../errors/errors.js';
import { isValidDocName } from '../kits/store/names.js';
import { inspectDocument } from '../kits/store/raw.js';
import type {
    DoctorCheck,
    DoctorCommandFn,
    DoctorFacts,
    DoctorWordsRead,
    Project,
    Style
} from '../models.js';
import { reportError } from '../run/report.js';
import { resolveWorld } from '../run/world.js';
import { messageOf } from '../utils/error-message.js';
import {
    DOCTOR_FLAGS,
    DOCTOR_HELP,
    DOCTOR_USAGE_LINE,
    DOCTOR_WORD,
    WORD_NAMES
} from './constants.js';
import { doctorFailure, runDoctor } from './doctor.js';
import { findProject, resolveSettings, resolveStateDir } from './settings.js';
import { shadowsWord } from './shadow.js';
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

        return { dir: commandsDir, exists: true, warnings: registry.warnings };
    } catch (error) {
        return { dir: '', exists: false, warnings: [], problem: messageOf(error) };
    }
}

/** The built-in words a command or topic of the project hides. */
function readHiddenWords(commands: DoctorFacts['commands']): string[] {
    const dir = commands?.exists ? commands.dir : undefined;

    return dir === undefined ? [] : WORD_NAMES.filter((word) => shadowsWord(dir, word));
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

/** Reads everything the checks need. A package.json that cannot be parsed is an error naming the file, as everywhere else. */
async function gatherFacts(cwd: string): Promise<DoctorFacts> {
    const running = readRunningPackage();
    const project = findProject(cwd, readManifest, isFolder, 'shipped');
    const local = findLocalCopy(project?.root ?? cwd);

    if (project === undefined) {
        return { running, local, project, commands: undefined, hiddenWords: [], state: undefined };
    }

    const commands = await readCommands(project);

    return {
        running,
        local,
        project,
        commands,
        hiddenWords: readHiddenWords(commands),
        state: readState(project)
    };
}

const STATUS_LABEL = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' } as const;

const checkLine = (check: DoctorCheck, style: Style): string => {
    const paint = { ok: style.green, warn: style.yellow, fail: style.red }[check.status];
    const fix = check.fix ? `\n      fix: ${check.fix}` : '';

    return `${paint(STATUS_LABEL[check.status])}  ${check.id.padEnd(9)} ${check.message}${fix}`;
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

    const facts = await gatherFacts(cwd);
    const checks = runDoctor(facts);
    const failure = doctorFailure(checks);

    if (read.json) {
        io.stdout.write(
            `${JSON.stringify(
                failure
                    ? { ok: false, command: DOCTOR_WORD, ...failure }
                    : {
                          ok: true,
                          command: DOCTOR_WORD,
                          result: { version: facts.running.version, checks }
                      }
            )}\n`
        );

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
