import path from 'node:path';

import { EXIT_CODE, NEXT_PREFIX } from '../constants.js';
import {
    createExclusive,
    isFolder,
    makeDirectory,
    pathExists,
    readManifest
} from '../edges/files.js';
import { CommandError } from '../errors/errors.js';
import type { NewCommandFn, NewSpec, Project } from '../models.js';
import { printResult } from '../run/report.js';
import { resolveWorld } from '../run/world.js';
import { messageOf } from '../utils/error-message.js';
import { COMMAND_FILE_EXTENSION, NEW_HELP, NEW_WORD, TYPE_WARNING } from './constants.js';
import { checkNew, commandFile, parseNewWords, renderCommand } from './new.js';
import { findProject, noProjectError, resolveSettings } from './settings.js';
import { wordHelp } from './word-help.js';

const MODULE_TYPE = 'module';

/** The file exists: nothing is written over it. */
const fileExists = (file: string): CommandError =>
    new CommandError(`${file} already exists`, {
        hint: 'Pick another name, or edit that file: new never overwrites one.'
    });

/** The folder of a topic with the name of the command is there: a name cannot be both. */
const topicExists = (folder: string, id: string): CommandError =>
    new CommandError(
        `${folder} is a topic (a folder of commands), so "${id}" cannot be a command`,
        {
            hint: 'Pick another name, or put the command inside that topic.'
        }
    );

/** An earlier word is already a command file: a name cannot be both a command and a topic. */
const commandIsTopic = (file: string, prefix: string): CommandError =>
    new CommandError(`${file} is already the command "${prefix}", which cannot also be a topic`, {
        hint: 'Pick another name for the new command.'
    });

/** The words of the id that are already a command file, as the first of them and its file. */
function earlierCommand(
    commandsDir: string,
    words: readonly string[]
): { prefix: string; file: string } | undefined {
    return words
        .slice(0, -1)
        .map((_, index) => words.slice(0, index + 1))
        .map((prefix) => ({
            prefix: prefix.join(' '),
            file: path.join(commandsDir, ...prefix) + COMMAND_FILE_EXTENSION
        }))
        .find(({ file }) => pathExists(file));
}

/** Refuses, with nothing written, a name that is already a command file or a topic. */
function assertFree(commandsDir: string, words: readonly string[], file: string): void {
    const id = words.join(' ');
    const folder = file.slice(0, -COMMAND_FILE_EXTENSION.length);
    const earlier = earlierCommand(commandsDir, words);

    if (pathExists(file)) {
        throw fileExists(file);
    }

    if (isFolder(folder)) {
        throw topicExists(folder, id);
    }

    if (earlier !== undefined) {
        throw commandIsTopic(earlier.file, earlier.prefix);
    }
}

/** Writes the file, creating the folders. A file that appears meanwhile is refused too. */
function writeCommandFile(file: string, spec: NewSpec): void {
    try {
        makeDirectory(path.dirname(file));
    } catch (error) {
        throw new CommandError(`Cannot create the folder of ${file}: ${messageOf(error)}`, {
            hint: 'Check that no part of that path is a file, and that you can write there.'
        });
    }

    if (!createExclusive(file, renderCommand(spec))) {
        throw fileExists(file);
    }
}

/** Where the project's commands are, creating nothing: the folder may not exist yet. */
function projectOf(cwd: string): Project {
    const project = findProject(cwd, readManifest, isFolder, 'shipped');

    if (!project) {
        throw noProjectError(cwd, 'shipped');
    }

    return project;
}

/**
 * `new <command words>... --description <text> [--arg <name>]... [--flag <name>]... [--destructive]
 * [--supports-dry-run]`: writes the file of a new command in the commands folder of the project,
 * never over a file that exists. Handled by the shipped binary itself. The words are read and
 * checked first, so `--help` and a wrong command line are answered where there is no project too.
 */
export const newCommand: NewCommandFn = (words, host, cwd) => {
    const read = parseNewWords(words);
    const { io } = resolveWorld(host);

    if (read.help) {
        io.stdout.write(`${wordHelp({ id: NEW_WORD, text: NEW_HELP, json: read.json })}\n`);

        return EXIT_CODE.OK;
    }

    const spec = checkNew(read);
    const project = projectOf(cwd);
    const { bin, commandsDir } = resolveSettings(project, 'shipped');
    const file = commandFile(commandsDir, spec.words);
    const id = spec.words.join(' ');
    const next = `${bin} ${id} --help`;

    assertFree(commandsDir, spec.words, file);
    writeCommandFile(file, spec);

    if (project.manifest.type !== MODULE_TYPE && !read.quiet) {
        io.stderr.write(`Warning: ${TYPE_WARNING}\n`);
    }

    printResult(io, {
        json: read.json,
        command: NEW_WORD,
        text: `Created ${file}`,
        result: { id, file },
        extras: { next: [next] }
    });

    if (!read.json && !read.quiet) {
        io.stderr.write(`${NEXT_PREFIX} ${next}\n`);
    }

    return EXIT_CODE.OK;
};
