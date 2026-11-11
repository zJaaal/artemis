import path from 'node:path';

import { UsageError } from '../errors/errors.js';
import type { InitCommandFn, InitResult } from '../models.js';
import { resolveWorld } from '../run/world.js';
import { INIT_FLAG_HELP, INIT_FLAG_HELP_SHORT, INIT_FLAG_JSON, INIT_WORD } from './constants.js';
import { initProject } from './init.js';

const USAGE = `Usage: ${INIT_WORD} [folder] [${INIT_FLAG_JSON}]\n\nMakes the folder (default: the current one) a project: a package.json with an "artemis" key, a commands/ folder and a sample command. Nothing that exists is overwritten.`;

const isFlag = (word: string): boolean => word.startsWith('-');

const isKnownFlag = (word: string): boolean =>
    [INIT_FLAG_JSON, INIT_FLAG_HELP, INIT_FLAG_HELP_SHORT].includes(word);

function describeResult({ created, kept, warnings }: InitResult): string {
    const lines = [
        ...created.map((file) => `Created ${file}`),
        ...kept.map((file) => `Kept    ${file} (already there)`),
        ...warnings.map((warning) => `Warning: ${warning}`)
    ];

    return created.length
        ? lines.join('\n')
        : ['Already a project: nothing to create.', ...lines].join('\n');
}

/**
 * `init [folder] [--json]`: makes a folder a project. Handled by the shipped binary itself, like
 * `help`, because it has to work where there is no project yet. Throws a UsageError for a bad line.
 */
export const initCommand: InitCommandFn = (words, options, cwd) => {
    const flags = words.filter(isFlag);
    const folders = words.filter((word) => !isFlag(word));
    const unknown = flags.find((flag) => !isKnownFlag(flag));
    const { io } = resolveWorld(options);

    if (unknown) {
        throw new UsageError(`Unknown option "${unknown}"`, { hint: USAGE });
    }

    if (folders.length > 1) {
        throw new UsageError('init takes at most one folder', { hint: USAGE });
    }

    if (flags.includes(INIT_FLAG_HELP) || flags.includes(INIT_FLAG_HELP_SHORT)) {
        io.stdout.write(`${USAGE}\n`);

        return 0;
    }

    const result = initProject(path.resolve(cwd, folders[0] ?? '.'));

    const output = flags.includes(INIT_FLAG_JSON)
        ? JSON.stringify({ ok: true, command: INIT_WORD, result })
        : describeResult(result);

    io.stdout.write(`${output}\n`);

    return 0;
};
