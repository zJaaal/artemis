import { format } from 'node:util';

import {
    ASKS_REGARDLESS_HINT,
    CANCELLED_MESSAGE,
    NOT_INTERACTIVE_HINT,
    NOT_INTERACTIVE_MESSAGE
} from '../constants.js';
import { askQuestion } from '../edges/prompts.js';
import { CommandError } from '../errors/errors.js';
import type {
    Choice,
    CreateContextFn,
    PromptOptions,
    Prompter,
    PrompterMode,
    Question
} from '../models.js';
import { isBoolean, isText, isTextList } from '../utils/is-text.js';

/** The library answered with something a question of this kind never returns: a bug, not a mistake. */
const unexpectedAnswer = (kind: Question['kind'], answer: unknown): TypeError =>
    new TypeError(`The ${kind} prompt answered with ${JSON.stringify(answer)}.`);

/** The choice an answer names, so the command gets its own typed value back and never a cast. */
const choiceFor = <TValue extends string>(
    choices: readonly Choice<TValue>[],
    answer: unknown
): TValue | undefined => choices.find((choice) => choice.value === answer)?.value;

/**
 * Asks one question, or refuses to hang when nobody can answer. A cancelled question is an error
 * (exit 1), so a command never has to check for it.
 */
async function ask(
    { interactive, flagsSkipQuestions }: PrompterMode,
    question: Question,
    { hint }: PromptOptions
): Promise<unknown> {
    if (!interactive) {
        throw new CommandError(NOT_INTERACTIVE_MESSAGE, {
            hint: hint ?? (flagsSkipQuestions ? ASKS_REGARDLESS_HINT : NOT_INTERACTIVE_HINT)
        });
    }

    const outcome = await askQuestion(question);

    if (outcome.kind === 'cancelled') {
        throw new CommandError(CANCELLED_MESSAGE);
    }

    return outcome.answer;
}

/** `ctx.prompt`: four typed questions that return the answer itself. */
export const createPrompter = (mode: PrompterMode): Prompter => ({
    confirm: async (message, options = {}) => {
        const answer = await ask(mode, { kind: 'confirm', message, options }, options);

        if (!isBoolean(answer)) {
            throw unexpectedAnswer('confirm', answer);
        }

        return answer;
    },
    text: async (message, options = {}) => {
        const answer = await ask(mode, { kind: 'text', message, options }, options);

        if (!isText(answer)) {
            throw unexpectedAnswer('text', answer);
        }

        return answer;
    },
    select: async (message, options) => {
        const answer = await ask(mode, { kind: 'select', message, options }, options);
        const value = choiceFor(options.choices, answer);

        if (value === undefined) {
            throw unexpectedAnswer('select', answer);
        }

        return value;
    },
    multiselect: async (message, options) => {
        const answer = await ask(mode, { kind: 'multiselect', message, options }, options);

        if (!isTextList(answer)) {
            throw unexpectedAnswer('multiselect', answer);
        }

        return answer.map((one) => {
            const value = choiceFor(options.choices, one);

            if (value === undefined) {
                throw unexpectedAnswer('multiselect', one);
            }

            return value;
        });
    }
});

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
    invoke,
    plan
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
    prompt: createPrompter({ interactive, flagsSkipQuestions: global.yes || global.json }),
    commands: [...registry.commands.values()],
    invoke,
    dryRun: global.dryRun,
    plan: (step) => {
        if (global.dryRun) {
            plan.push(step);
        }
    }
});
