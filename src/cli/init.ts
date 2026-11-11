import path from 'node:path';

import { CONFIG_KEY, DEFAULT_COMMANDS_FOLDER, MANIFEST_FILE } from '../constants.js';
import {
    isFolder,
    listDirectory,
    makeDirectory,
    readManifest,
    readTextIfExists,
    writeText
} from '../edges/files.js';
import type {
    DetectIndentFn,
    InitInput,
    InitPlan,
    InitProjectFn,
    InitStep,
    PackageNameForFn,
    PlanInitFn
} from '../models.js';
import {
    DEFAULT_INDENT_SPACES,
    FALLBACK_PACKAGE_NAME,
    INDENT_PATTERN,
    PACKAGE_NAME_EDGES,
    PACKAGE_NAME_INVALID,
    SAMPLE_COMMAND_FILE,
    SAMPLE_COMMAND_SOURCE,
    TYPE_WARNING
} from './constants.js';
import { resolveSettings } from './settings.js';

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

const declaration = { commandsDir: DEFAULT_COMMANDS_FOLDER };

const newManifest = (dir: string): string =>
    `${JSON.stringify(
        { name: packageNameFor(dir), private: true, type: 'module', [CONFIG_KEY]: declaration },
        null,
        ' '.repeat(DEFAULT_INDENT_SPACES)
    )}\n`;

/** The same package.json with the "artemis" key added at the end; nothing else changes. */
const withDeclaration = (text: string, manifest: Record<string, unknown>): string => {
    const trailingNewline = text.endsWith('\n') ? '\n' : '';

    return `${JSON.stringify({ ...manifest, [CONFIG_KEY]: declaration }, null, detectIndent(text))}${trailingNewline}`;
};

function planManifest(input: InitInput, manifestPath: string, plan: InitPlan): void {
    const { dir, manifest, manifestText } = input;

    if (manifest === undefined || manifestText === undefined) {
        plan.steps.push({ kind: 'file', path: manifestPath, text: newManifest(dir) });

        return;
    }

    if (manifest[CONFIG_KEY] !== undefined) {
        plan.kept.push(manifestPath);
    } else {
        plan.steps.push({
            kind: 'file',
            path: manifestPath,
            text: withDeclaration(manifestText, manifest)
        });
    }

    if (manifest.type !== 'module') {
        plan.warnings.push(TYPE_WARNING);
    }
}

/**
 * Decides what making a folder a project takes: a package.json with the "artemis" key (created, or
 * the key added to the one that is there), a commands folder, and a sample command so `hello` works
 * at once. Pure, and it never overwrites a file: the sample is only written into a commands folder
 * that is new or empty, and an existing package.json only gains the one key.
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
            path: path.join(input.commandsDir, SAMPLE_COMMAND_FILE),
            text: SAMPLE_COMMAND_SOURCE
        });
    }

    return plan;
};

function applyStep(step: InitStep): void {
    if (step.kind === 'folder') {
        makeDirectory(step.path);

        return;
    }

    makeDirectory(path.dirname(step.path));
    writeText(step.path, step.text);
}

/**
 * Makes `dir` a project: reads what is there, plans, and does it. Running it again changes nothing.
 * A package.json that cannot be read or parsed is an error: it would be guesswork to edit it.
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

    const commandsDirExists = isFolder(commandsDir);

    const plan = planInit({
        dir,
        manifest,
        manifestText: manifest ? readTextIfExists(path.join(dir, MANIFEST_FILE)) : undefined,
        commandsDir,
        commandsDirExists,
        commandsDirIsEmpty: commandsDirExists && listDirectory(commandsDir).length === 0
    });

    plan.steps.forEach(applyStep);

    return {
        root: dir,
        created: plan.steps.map((step) => step.path),
        kept: plan.kept,
        warnings: plan.warnings
    };
};
