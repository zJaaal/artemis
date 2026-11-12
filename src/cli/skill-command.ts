import path from 'node:path';

import { EXIT_CODE, NOT_INTERACTIVE_MESSAGE } from '../constants.js';
import { createPrompter } from '../context/context.js';
import { discover } from '../discover/discover.js';
import { isFolder, makeDirectory, pathExists, readManifest, writeText } from '../edges/files.js';
import { CommandError } from '../errors/errors.js';
import { manifest } from '../help/help.js';
import type { IO, SkillCommandFn, SkillWords } from '../models.js';
import { successEnvelope } from '../run/report.js';
import { isNonEmptyText } from '../utils/is-text.js';
import { resolveWorld } from '../run/world.js';
import {
    SKILL_HELP,
    SKILL_OVERWRITE_HINT_PREFIX,
    SKILL_SHADOW_WARNING,
    SKILL_WORD
} from './constants.js';
import { findProject, noProjectError, resolveSettings } from './settings.js';
import { shadowsWord } from './shadow.js';
import { buildSkill } from './skill.js';
import { parseSkillWords } from './skill-words.js';
import { wordHelp } from './word-help.js';

/** Text for a person, or under --json the one object the contract promises. */
function print(io: IO, json: boolean, text: string, result: unknown): void {
    io.stdout.write(`${json ? successEnvelope(SKILL_WORD, result) : text}\n`);
}

/** Whether the file may be written: it is not there, or `--yes`, or the person says yes. Nobody to ask is an error. */
async function mayWrite(target: string, words: SkillWords, interactive: boolean): Promise<boolean> {
    if (!pathExists(target) || words.yes) {
        return true;
    }

    if (!interactive) {
        throw new CommandError(NOT_INTERACTIVE_MESSAGE, {
            hint: `${SKILL_OVERWRITE_HINT_PREFIX} ${target}.`
        });
    }

    return createPrompter({ interactive: true, flagsSkipQuestions: false }).confirm(
        `Overwrite ${target}?`,
        { hint: `${SKILL_OVERWRITE_HINT_PREFIX} ${target}.` }
    );
}

/**
 * `skill [--write <path>] [--yes] [--quiet] [--json]`: the SKILL.md of this project, built from its
 * commands. Handled by the shipped binary itself, like `init`, `state` and `doctor`. It never
 * overwrites a file without asking: in a terminal it asks, and otherwise it needs `--yes`.
 */
export const skillCommand: SkillCommandFn = async (words, options, cwd) => {
    const parsed = parseSkillWords(words);
    const { io, canPrompt } = resolveWorld(options);

    if (parsed.help) {
        io.stdout.write(`${wordHelp({ id: SKILL_WORD, text: SKILL_HELP, json: parsed.json })}\n`);

        return EXIT_CODE.OK;
    }

    const project = findProject(cwd, readManifest, isFolder, 'shipped');

    if (!project) {
        throw noProjectError(cwd, 'shipped');
    }

    const { bin, commandsDir } = resolveSettings(project, 'shipped');

    if (shadowsWord(commandsDir, SKILL_WORD) && !parsed.quiet) {
        io.stderr.write(`Warning: ${SKILL_SHADOW_WARNING}\n`);
    }

    const registry = await discover(commandsDir);
    const { name, description } = project.manifest;

    const markdown = buildSkill(manifest(bin, registry), {
        name: isNonEmptyText(name) ? name : undefined,
        description: isNonEmptyText(description) ? description : undefined
    });

    if (parsed.write === undefined) {
        print(io, parsed.json, markdown.trimEnd(), { markdown });

        return EXIT_CODE.OK;
    }

    const target = path.resolve(cwd, parsed.write);
    const interactive = canPrompt && !parsed.yes && !parsed.json;

    if (!(await mayWrite(target, parsed, interactive))) {
        io.stdout.write(`Not written: ${target} is unchanged.\n`);

        return EXIT_CODE.OK;
    }

    makeDirectory(path.dirname(target));
    writeText(target, markdown);
    print(io, parsed.json, `Wrote ${target}`, { file: target });

    return EXIT_CODE.OK;
};
