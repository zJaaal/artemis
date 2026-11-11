import { format } from 'node:util';

import { CANCELLED_MESSAGE, NOT_INTERACTIVE_HINT, NOT_INTERACTIVE_MESSAGE } from '../constants.js';
import { askQuestions } from '../edges/prompts.js';
import { CommandError } from '../errors/errors.js';
import type { CreateContextFn, PromptFn } from '../models.js';

/** `ctx.prompt`: asks the user, or refuses to hang when nobody can answer. */
const createPrompt =
    (interactive: boolean): PromptFn =>
    async (questions, { hint } = {}) => {
        if (!interactive) {
            throw new CommandError(NOT_INTERACTIVE_MESSAGE, { hint: hint ?? NOT_INTERACTIVE_HINT });
        }

        const { answers, cancelled } = await askQuestions(questions);

        if (cancelled) {
            throw new CommandError(CANCELLED_MESSAGE);
        }

        return answers;
    };

/**
 * The `ctx` a command receives. It keeps commands honest about their environment: `log` stays
 * quiet under --json so stdout is parseable, and `prompt` refuses to hang when nobody can answer.
 */
export const createContext: CreateContextFn = ({
    io,
    global,
    interactive,
    style,
    registry,
    invoke
}) => ({
    json: global.json,
    interactive,
    style,
    log: (...parts) => {
        if (!global.json) {
            io.stdout.write(`${format(...parts)}\n`);
        }
    },
    warn: (...parts) => {
        io.stderr.write(`${format(...parts)}\n`);
    },
    prompt: createPrompt(interactive),
    commands: [...registry.commands.values()],
    invoke
});
