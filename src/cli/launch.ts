import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_KEY, EXIT_CODE, LOG_FLAG, MANIFEST_FILE, URL_LIKE } from '../constants.js';
import { isFolder } from '../edges/files.js';
import { currentProcess } from '../edges/process.js';
import { workingDirectory } from '../edges/system.js';
import { CommandError } from '../errors/errors.js';
import type {
    CliFn,
    CliRoute,
    CliSettings,
    FolderOfRootFn,
    HostOptions,
    Project,
    ShippedWord
} from '../models.js';
import { reportError } from '../run/report.js';
import { run } from '../run/run.js';
import { resolveWorld } from '../run/world.js';
import { messageOf } from '../utils/error-message.js';
import { hasLogFlag, splitLeadingFlags } from '../resolve/resolve.js';
import { jsonRequested, quietRequested } from '../utils/terminator.js';
import {
    BUILTINS,
    DOCTOR_WORD,
    HISTORY_BUILTINS,
    HISTORY_WORD,
    INIT_WORD,
    NEW_WORD,
    SKILL_WORD,
    STATE_WORD
} from './constants.js';
import { historyCommand, shippedHistory, writeHistoryHelp } from './history-command.js';
import { parseHistoryWords } from './history.js';
import { newCommand } from './new-command.js';
import { skillCommand } from './skill-command.js';
import { doctorCommand } from './doctor-command.js';
import { initCommand } from './init-command.js';
import { assertLeadingFlags } from './state.js';
import { stateCommand } from './state-command.js';
import { projectOrThrow } from './project.js';
import { resolveAuditFile, resolveSettings } from './settings.js';
import { pointsOutside } from '../utils/points-outside.js';
import { flagWithoutCommand } from '../utils/flag-without-command.js';
import { versionWarning } from './version-warning.js';

/** What `root` stands for as a path, or a CommandError that says what to pass instead. */
function pathOfRoot(root: string | URL): string {
    try {
        if (typeof root === 'string' && root !== '' && !URL_LIKE.test(root)) {
            return root;
        }

        return fileURLToPath(root);
    } catch (error) {
        throw new CommandError(
            `cli({ root }) needs the location of your bin file, but got ${String(root)} (${messageOf(error)})`,
            {
                hint: 'Pass import.meta.url from your bin file, or a path.'
            }
        );
    }
}

/** The folder a bin file is in (`import.meta.url`), or the folder itself when given one. */
const folderOfRoot: FolderOfRootFn = (root) => {
    const target = pathOfRoot(root);

    return isFolder(target) ? target : path.dirname(target);
};

/**
 * The commands folder is missing. For a person running a project: create it, or point `commandsDir`
 * at a parent's (unless it already points outside). For a published tool the end user cannot fix
 * anything, so the hint is for its author, and never suggests running another package's commands.
 */
const missingCommandsError = (commandsDir: string, projectRoot: string, route: CliRoute) => {
    const manifestPath = path.join(projectRoot, MANIFEST_FILE);
    const create = `Create ${commandsDir}, or set "${CONFIG_KEY}": { "commandsDir" } in ${manifestPath}.`;

    const parent =
        ' If the commands live in a parent folder, point commandsDir at them, for example "../commands".';

    const author = ` If this is a published tool, its author has to ship the commands folder (add it to "files" in ${MANIFEST_FILE}).`;

    if (route === 'own') {
        return new CommandError(`Commands folder not found: ${commandsDir}`, {
            hint: create + author
        });
    }

    return new CommandError(`Commands folder not found: ${commandsDir}`, {
        hint: pointsOutside(commandsDir, projectRoot) ? create : create + parent
    });
};

/** The commands folder of the settings of a project must exist: or a CommandError that says what to create. */
function assertCommandsFolder(settings: CliSettings, project: Project, route: CliRoute): void {
    if (!isFolder(settings.commandsDir)) {
        throw missingCommandsError(settings.commandsDir, project.root, route);
    }
}

const SHIPPED_WORDS: readonly ShippedWord[] = [
    { word: INIT_WORD, run: initCommand },
    { word: STATE_WORD, run: (words, host, cwd) => stateCommand(words, host, cwd) },
    { word: SKILL_WORD, run: skillCommand },
    { word: DOCTOR_WORD, run: doctorCommand },
    { word: HISTORY_WORD, run: shippedHistory },
    { word: NEW_WORD, run: newCommand }
];

/** Prints the one-line version warning to stderr, when the running Artemis is not the project's. */
function warnAboutVersion(project: Project, host: HostOptions): void {
    const { io, style } = resolveWorld(host);
    const warning = versionWarning(project, style);

    if (warning !== undefined) {
        io.stderr.write(`${warning}\n`);
    }
}

/** A setup failure goes out the way any failure does: one object under --json, text otherwise. */
function reportSetupFailure(
    argv: string[],
    error: unknown,
    host: HostOptions,
    commandId?: string
): number {
    const { io, style } = resolveWorld(host);

    return reportError(error, { io, style, json: jsonRequested(argv), commandId });
}

/**
 * Finds the project and runs the command line against its commands folder. Returns the exit code
 * and never calls process.exit.
 *
 * With `root` (a project's own bin file: `cli({ root: import.meta.url })`) the project is the one
 * the bin file belongs to, wherever the user is standing. Without it (the shipped `art` and
 * `artemis`) the project is the one of the current folder, or of `cwd`.
 */
export const launch: CliFn = async (options = {}) => {
    const { argv = currentProcess().args, cwd, root, ...host } = options;
    const route: CliRoute = root === undefined ? 'shipped' : 'own';
    const { leading, rest } = splitLeadingFlags(argv);

    // `--log` takes the next word as its file, so `art --log init` is a log file called init and no command
    if (!rest.length && hasLogFlag(leading)) {
        return reportSetupFailure(argv, flagWithoutCommand(LOG_FLAG, undefined), host);
    }

    // The shipped binary's own words, like `help`. `init` and `doctor` have to work where there is no project
    // (`init` makes one, `doctor` reports its absence); `state` and `skill` need none of the commands to load.
    const word =
        route === 'shipped' ? SHIPPED_WORDS.find(({ word: name }) => name === rest[0]) : undefined;

    if (word) {
        try {
            assertLeadingFlags(leading, word.word);

            return await word.run(
                [...leading, ...rest.slice(1)],
                host,
                path.resolve(cwd ?? workingDirectory())
            );
        } catch (error) {
            return reportSetupFailure(
                argv,
                error,
                host,
                word.word === INIT_WORD ? undefined : word.word
            );
        }
    }

    let project: Project;
    let auditFile: string | undefined;
    let settings: CliSettings;
    let isToolHistory: boolean;

    try {
        const start = path.resolve(
            root === undefined ? (cwd ?? workingDirectory()) : folderOfRoot(root)
        );

        project = projectOrThrow(start, route);
        auditFile = resolveAuditFile(project, route);
        settings = resolveSettings(project, route);

        // A tool that turned auditing on has the word `history`: it needs the project, not commands that load
        isToolHistory = route === 'own' && auditFile !== undefined && rest[0] === HISTORY_WORD;

        if (!isToolHistory) {
            assertCommandsFolder(settings, project, route);
        }
    } catch (error) {
        return reportSetupFailure(argv, error, host);
    }

    if (isToolHistory) {
        try {
            assertLeadingFlags(leading, HISTORY_WORD);

            const parsed = parseHistoryWords([...leading, ...rest.slice(1)]);

            if (parsed.help) {
                writeHistoryHelp(host, parsed.json, settings.bin);

                return EXIT_CODE.OK;
            }

            return await historyCommand(parsed, host, { project, settings });
        } catch (error) {
            return reportSetupFailure(argv, error, host, HISTORY_WORD);
        }
    }

    if (route === 'shipped' && !quietRequested(argv)) {
        warnAboutVersion(project, host);
    }

    return run(argv, {
        ...host,
        ...settings,
        cwd,
        ...(route === 'shipped' ? { builtins: BUILTINS } : {}),
        ...(auditFile === undefined ? {} : { auditFile }),
        ...(route === 'own' && auditFile !== undefined ? { builtins: HISTORY_BUILTINS } : {})
    });
};
