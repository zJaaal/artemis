import { EXIT_CODE } from '../constants.js';
import { UsageError } from '../errors/errors.js';
import type { InitCommandFn, InitResult } from '../models.js';
import { resolveWorld } from '../run/world.js';
import { INIT_FLAGS, INIT_HELP, INIT_USAGE_LINE, INIT_WORD } from './constants.js';
import { initProject } from './init.js';

const KNOWN_WORDS: readonly string[] = Object.values(INIT_FLAGS);

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
 * `init [--json]`: makes the current folder a project. Handled by the shipped binary itself, like
 * `help`, because it has to work where there is no project yet. It is a fixed word and not a command
 * a person writes, so it takes no arguments and no flags beyond `--json` and `--help`: anything else
 * is a UsageError (exit 2).
 */
export const initCommand: InitCommandFn = (words, options, cwd) => {
    const unexpected = words.find((word) => !KNOWN_WORDS.includes(word));
    const { io } = resolveWorld(options);

    if (unexpected) {
        throw new UsageError(`${INIT_WORD} takes no arguments, but got "${unexpected}"`, {
            usage: INIT_USAGE_LINE,
            hint: 'Go to the folder you want to make a project, then run it.'
        });
    }

    if (words.includes(INIT_FLAGS.help) || words.includes(INIT_FLAGS.helpShort)) {
        io.stdout.write(`${INIT_HELP}\n`);

        return EXIT_CODE.OK;
    }

    const result = initProject(cwd);

    const output = words.includes(INIT_FLAGS.json)
        ? JSON.stringify({ ok: true, command: INIT_WORD, result })
        : describeResult(result);

    io.stdout.write(`${output}\n`);

    return EXIT_CODE.OK;
};
