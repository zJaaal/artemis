import path from 'node:path';

import {
    AGENTS_DOC_FILE,
    CLAUDE_DOC_FILE,
    CONFIG_KEY,
    DEFAULT_BIN_NAME,
    DEFAULT_COMMANDS_FOLDER,
    DEFAULT_STATE_FOLDER,
    GITIGNORE_FILE,
    MANIFEST_FILE
} from '../constants.js';
import {
    appendText,
    createExclusive,
    isFolder,
    listDirectory,
    makeDirectory,
    pathExists,
    readManifest,
    readTextIfExists,
    realPathOrResolve,
    writeText
} from '../edges/files.js';
import { CommandError } from '../errors/errors.js';
import type {
    AddKeyFn,
    DetectIndentFn,
    InitInput,
    InitPlan,
    InitProjectFn,
    InitStep,
    PointerInput,
    PackageNameForFn,
    PlanInitFn,
    TextFile
} from '../models.js';
import {
    CRLF,
    DEFAULT_INDENT_SPACES,
    FALLBACK_PACKAGE_NAME,
    INDENT_PATTERN,
    INIT_DECLARATION,
    INIT_WORD,
    LF,
    NEW_MANIFEST_FIELDS,
    PACKAGE_NAME_EDGES,
    PACKAGE_NAME_INVALID,
    SAMPLE_COMMAND_FILE,
    SAMPLE_COMMAND_SOURCE,
    SHADOW_WARNING,
    TYPE_WARNING
} from './constants.js';
import { gitignoreLine, planPointer } from './agent-pointer.js';
import { shadowsWord } from './shadow.js';
import { resolveSettings, resolveStateDir } from './settings.js';

/** The indentation a package.json already uses, so editing it does not reformat the whole file. */
export const detectIndent: DetectIndentFn = (text) =>
    INDENT_PATTERN.exec(text)?.[1] ?? ' '.repeat(DEFAULT_INDENT_SPACES);

/** A valid npm package name for a folder: lowercase, no spaces or odd characters. */
export const packageNameFor: PackageNameForFn = (dir) => {
    const name = path
        .basename(dir)
        .toLowerCase()
        .replace(PACKAGE_NAME_INVALID, '-')
        .replace(PACKAGE_NAME_EDGES, '');

    return name || FALLBACK_PACKAGE_NAME;
};

/** `{ "commandsDir": "commands" }`, on one line, for adding to a file without reformatting it. */
const declarationText = (): string =>
    `{ ${Object.entries(INIT_DECLARATION)
        .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
        .join(', ')} }`;

/**
 * The same JSON object with one more property at the end. Only that changes: every byte before it,
 * the indentation, inline arrays, key order, line endings (CRLF stays CRLF) and the final newline are
 * kept, because the text is edited and not parsed and written back.
 */
export const addKey: AddKeyFn = (text, key, valueText) => {
    const closing = /^([\s\S]*)\}(\s*)$/.exec(text);
    const body = (closing?.[1] ?? text).trimEnd();
    const after = closing?.[2] ?? '';
    const comma = body.endsWith('{') ? '' : ',';
    const property = `${JSON.stringify(key)}: ${valueText}`;

    // A file written on one line stays on one line.
    if (!text.includes(LF)) {
        return `${body}${comma} ${property} }${after}`;
    }

    const eol = text.includes(CRLF) ? CRLF : LF;

    return `${body}${comma}${eol}${detectIndent(text)}${property}${eol}}${after}`;
};

const newManifest = (dir: string): string =>
    `${JSON.stringify(
        { name: packageNameFor(dir), ...NEW_MANIFEST_FIELDS, [CONFIG_KEY]: INIT_DECLARATION },
        null,
        ' '.repeat(DEFAULT_INDENT_SPACES)
    )}\n`;

function planManifest(input: InitInput, manifestPath: string, plan: InitPlan): void {
    const { dir, manifest, manifestText } = input;

    if (manifest === undefined || manifestText === undefined) {
        plan.steps.push({
            kind: 'file',
            mode: 'create',
            path: manifestPath,
            text: newManifest(dir)
        });

        return;
    }

    if (manifest[CONFIG_KEY] !== undefined) {
        plan.kept.push(manifestPath);
    } else {
        plan.steps.push({
            kind: 'file',
            mode: 'update',
            path: manifestPath,
            text: addKey(manifestText, CONFIG_KEY, declarationText())
        });
    }

    if (manifest.type !== 'module') {
        plan.warnings.push(TYPE_WARNING);
    }
}

/**
 * Decides what making a folder a project takes: a package.json with the "artemis" key (created, or
 * the key added to the one that is there), a commands folder, and a sample command so `hello` works
 * at once. Pure, and it never overwrites: files are only planned where there is none, the sample only
 * into a commands folder that is new or empty, and an existing package.json only gains the one key.
 */
export const planInit: PlanInitFn = (input) => {
    const plan: InitPlan = { steps: [], kept: [], warnings: [] };

    planManifest(input, path.join(input.dir, MANIFEST_FILE), plan);

    if (input.commandsDirExists) {
        plan.kept.push(input.commandsDir);
    } else {
        plan.steps.push({ kind: 'folder', path: input.commandsDir });
    }

    if (!input.commandsDirExists || input.commandsDirIsEmpty) {
        plan.steps.push({
            kind: 'file',
            mode: 'create',
            path: path.join(input.commandsDir, SAMPLE_COMMAND_FILE),
            text: SAMPLE_COMMAND_SOURCE
        });
    }

    if (input.shadowsCommand) {
        plan.warnings.push(SHADOW_WARNING);
    }

    if (input.pointer) {
        plan.steps.push(...planPointer(input.pointer));
    }

    return plan;
};

/** Does one step. A file to create is created exclusively: it fails, never overwrites, if it appeared meanwhile. */
function applyStep(step: InitStep): void {
    if (step.kind === 'folder') {
        makeDirectory(step.path);

        return;
    }

    makeDirectory(path.dirname(step.path));

    if (step.mode === 'update') {
        writeText(step.path, step.text);

        return;
    }

    if (step.mode === 'append') {
        appendText(step.path, step.text);

        return;
    }

    if (!createExclusive(step.path, step.text)) {
        throw new CommandError(`${step.path} already exists`, {
            hint: 'init never overwrites a file. Move it, or run init in another folder.'
        });
    }
}

/** A commands path that exists as something other than a folder cannot become one. */
function assertCommandsDirIsUsable(commandsDir: string): void {
    if (pathExists(commandsDir) && !isFolder(commandsDir)) {
        throw new CommandError(`${commandsDir} exists but is not a folder`, {
            hint: `Move it, or set "${CONFIG_KEY}": { "commandsDir" } in ${MANIFEST_FILE} to another folder.`
        });
    }
}

/** A text file of the folder, with the file it really is; undefined when it is not there. */
function readTextFile(file: string): TextFile | undefined {
    const text = readTextIfExists(file);

    return text === undefined ? undefined : { path: file, real: realPathOrResolve(file), text };
}

/** What the agent pointer and the gitignore line are decided from: the files of the folder, and the settings. */
function readPointerInput(
    dir: string,
    manifest: Record<string, unknown> | undefined
): PointerInput {
    const project = manifest ? { root: dir, manifest } : undefined;
    const stateDir = project ? resolveStateDir(project) : path.join(dir, DEFAULT_STATE_FOLDER);

    return {
        dir,
        bin: project ? resolveSettings(project, 'shipped').bin : DEFAULT_BIN_NAME,
        agents: readTextFile(path.join(dir, AGENTS_DOC_FILE)),
        claude: readTextFile(path.join(dir, CLAUDE_DOC_FILE)),
        gitignore: readTextFile(path.join(dir, GITIGNORE_FILE)),
        gitignoreLine: gitignoreLine(dir, stateDir)
    };
}

/**
 * Makes `dir` a project: reads what is there once, plans, and does it. Running it again changes
 * nothing. A package.json that cannot be read or parsed is an error: editing it would be guesswork.
 */
export const initProject: InitProjectFn = (dir) => {
    const read = readManifest(dir);

    if (read && 'error' in read) {
        throw read.error;
    }

    const manifest = read?.manifest;

    const commandsDir = manifest
        ? resolveSettings({ root: dir, manifest }, 'shipped').commandsDir
        : path.join(dir, DEFAULT_COMMANDS_FOLDER);

    assertCommandsDirIsUsable(commandsDir);

    const commandsDirExists = isFolder(commandsDir);

    const plan = planInit({
        dir,
        manifest,
        manifestText: read?.text,
        commandsDir,
        commandsDirExists,
        commandsDirIsEmpty: commandsDirExists && listDirectory(commandsDir).length === 0,
        shadowsCommand: shadowsWord(commandsDir, INIT_WORD),
        pointer: readPointerInput(dir, manifest)
    });

    plan.steps.forEach(applyStep);

    const isAppend = (step: InitStep): boolean => step.kind === 'file' && step.mode === 'append';

    return {
        root: dir,
        created: plan.steps.filter((step) => !isAppend(step)).map((step) => step.path),
        changed: plan.steps.filter(isAppend).map((step) => step.path),
        kept: plan.kept,
        warnings: plan.warnings
    };
};
