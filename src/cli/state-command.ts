import path from 'node:path';

import {
    CONFIG_KEY,
    EXIT_CODE,
    JSON_EXTENSION,
    MANIFEST_FILE,
    NOT_INTERACTIVE_MESSAGE
} from '../constants.js';
import { createPrompter } from '../context/context.js';
import { isFolder, listJsonFiles, pathExists, readManifest } from '../edges/files.js';
import { CommandError } from '../errors/errors.js';
import { STORE_INDENT_SPACES } from '../kits/store/constants.js';
import { resolveLockEdges } from '../kits/store/lock-options.js';
import { isValidDocName } from '../kits/store/names.js';
import { inspectDocument, removeDocument } from '../kits/store/raw.js';
import { wrapVersion } from '../kits/store/versions.js';
import { messageOf } from '../utils/error-message.js';
import type { StatePlan, StateCommandFn, StateRun } from '../models.js';
import { resolveWorld } from '../run/world.js';
import {
    NO_STATE_YET,
    STATE_HELP,
    STATE_RECOVERY_HINT,
    STATE_RESET_HINT,
    STATE_SHADOW_WARNING,
    STATE_WORD
} from './constants.js';
import { successEnvelope } from '../run/report.js';
import { findProject, noProjectError, resolveSettings, resolveStateDir } from './settings.js';
import { shadowsWord } from './shadow.js';
import { parseStateWords, planState } from './state.js';
import { wordHelp } from './word-help.js';

/** The names of the documents in a folder: its valid-named `*.json` files, without the extension. */
function documentNames(dir: string): string[] {
    try {
        return listJsonFiles(dir)
            .map((file) => path.basename(file, JSON_EXTENSION))
            .filter(isValidDocName);
    } catch (error) {
        throw new CommandError(`Cannot read the state folder ${dir}: ${messageOf(error)}`, {
            hint: `Check the permissions of ${dir}, or fix "${CONFIG_KEY}".stateDir in ${MANIFEST_FILE}.`
        });
    }
}

const fileOf = (dir: string, name: string): string => path.join(dir, `${name}${JSON_EXTENSION}`);

/** A path as a person reads it: relative to where they are. */
const shown = (run: StateRun, target: string): string => path.relative(run.cwd, target) || target;

/** Text for a person, or under --json the one object the contract promises. */
function print(run: StateRun, text: string, result: unknown): void {
    const output = run.json ? successEnvelope(STATE_WORD, result) : text;

    run.io.stdout.write(`${output}\n`);
}

/** The state folder may not exist yet, but what is there must be a folder: a file is a setup mistake. */
function assertStateFolder(dir: string): void {
    if (pathExists(dir) && !isFolder(dir)) {
        throw new CommandError(`The state folder ${dir} is not a folder.`, {
            hint: `Fix "${CONFIG_KEY}".stateDir in ${MANIFEST_FILE}, or remove that file.`
        });
    }
}

/** What `art state` found about one document: its version, or why it cannot be read. */
function describeDocument(dir: string, name: string) {
    const file = fileOf(dir, name);
    const found = inspectDocument(file);

    return 'error' in found
        ? { name, version: null, file, error: found.error }
        : { name, version: found.version, file };
}

/** Lists every document. One that cannot be read is listed with its error: `--reset` is how it gets fixed. */
function listDocuments(run: StateRun): number {
    const documents = run.existing.map((name) => describeDocument(run.dir, name));

    const lines = documents.map((document) =>
        'error' in document
            ? `${document.name}  cannot be read: ${document.error}`
            : `${document.name}  v${document.version}  ${shown(run, document.file)}`
    );

    const text = documents.length ? lines.join('\n') : `${NO_STATE_YET} ${shown(run, run.dir)}.`;

    print(run, text, { dir: run.dir, documents });

    return EXIT_CODE.OK;
}

function showDocument(run: StateRun, name: string): number {
    const file = fileOf(run.dir, name);
    const found = inspectDocument(file);

    if ('error' in found) {
        throw new CommandError(found.error, { hint: STATE_RECOVERY_HINT });
    }

    const text = JSON.stringify(wrapVersion(found.data, found.version), null, STORE_INDENT_SPACES);

    print(run, text, { name, version: found.version, file, data: found.data });

    return EXIT_CODE.OK;
}

/** Whether the person said yes. Nobody to ask, or `--yes`, was decided by the plan already. */
const isConfirmed = async (run: StateRun, name: string): Promise<boolean> =>
    createPrompter({ interactive: run.interactive, flagsSkipQuestions: false }).confirm(
        `Reset ${name}? The app starts again from its defaults.`,
        { hint: STATE_RESET_HINT }
    );

/** Deletes the document under its lock, without reading it, so a corrupt one can be reset too. */
async function resetDocument(run: StateRun, name: string, ask: boolean): Promise<number> {
    if (ask && !(await isConfirmed(run, name))) {
        run.io.stdout.write(`Not reset: ${name} is unchanged.\n`);

        return EXIT_CODE.OK;
    }

    const file = fileOf(run.dir, name);

    removeDocument(file, resolveLockEdges(run.lock));
    print(run, `Reset ${name}: deleted ${shown(run, file)}.`, { name, file, reset: true });

    return EXIT_CODE.OK;
}

/** Carries out what was planned. A name that is not a document, or a reset nobody can confirm, is an error. */
async function carryOut(run: StateRun, plan: StatePlan): Promise<number> {
    switch (plan.kind) {
        case 'list':
            return listDocuments(run);
        case 'show':
            return showDocument(run, plan.name);
        case 'reset':
            return resetDocument(run, plan.name, plan.ask);
        case 'cannot-ask':
            throw new CommandError(NOT_INTERACTIVE_MESSAGE, { hint: STATE_RESET_HINT });
        case 'unknown':
            throw new CommandError(`No document ${plan.name} in ${run.dir}`, {
                hint: run.existing.length
                    ? `Documents there: ${run.existing.join(', ')}.`
                    : 'There are no documents yet.'
            });
    }
}

/**
 * `state [<doc>] [--reset] [--yes] [--json]`: lists the documents the app keeps in its state
 * folder, shows one, or resets one. Handled by the shipped binary itself, like `init`: it never
 * loads app code, so it reads the folder from `"artemis".stateDir`, which is also where
 * `defineStore({ project })` keeps its documents. It needs a project, but not a commands folder.
 */
export const stateCommand: StateCommandFn = async (words, host, cwd, edges = { lock: {} }) => {
    const parsed = parseStateWords(words);
    const { io, canPrompt } = resolveWorld(host);

    if (parsed.help) {
        io.stdout.write(`${wordHelp({ id: STATE_WORD, text: STATE_HELP, json: parsed.json })}\n`);

        return EXIT_CODE.OK;
    }

    const project = findProject(cwd, readManifest, isFolder, 'shipped');

    if (!project) {
        throw noProjectError(cwd, 'shipped');
    }

    const dir = resolveStateDir(project);

    assertStateFolder(dir);

    const existing = documentNames(dir);
    const interactive = canPrompt && !parsed.yes && !parsed.json;

    const isShadowed = shadowsWord(resolveSettings(project, 'shipped').commandsDir, STATE_WORD);

    if (isShadowed && !parsed.quiet) {
        io.stderr.write(`Warning: ${STATE_SHADOW_WARNING}\n`);
    }

    const plan = planState({ words: parsed, interactive, existing });

    return carryOut(
        { io, dir, cwd, json: parsed.json, interactive, existing, lock: edges.lock },
        plan
    );
};
