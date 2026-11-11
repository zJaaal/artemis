import readline from 'node:readline';

import { INTERRUPT_KEY, SHOW_CURSOR } from '../constants.js';
import type { Choice, AskFn, AskQuestionFn, IsAbortFn, PromptStreams } from '../models.js';

// Edge: the only place `@topcli/prompts` is loaded (and only when a command really asks) and the
// only place that reads keys from the terminal.

/** The library's own choice shape, with a description only when there is one. */
const toLibraryChoice = ({ label, value, description }: Choice<string>) => ({
    label,
    value,
    ...(description === undefined ? {} : { description })
});

/** The library rejects with an error named AbortError when its signal fires (it does not export the class). */
const isAbort: IsAbortFn = (error) => error instanceof Error && error.name === 'AbortError';

/** Ctrl+C reaches us as a keypress, because the library puts stdin in raw mode and never listens for it. */
const isInterrupt = (key: readline.Key | undefined): boolean =>
    key?.ctrl === true && key.name === INTERRUPT_KEY;

/** Maps one question onto the library's call, with the terminal and the signal that cancels it. */
export const askWithLibrary: AskFn = async (question, { stdin, stdout }, signal) => {
    const { confirm, multiselect, question: text, select } = await import('@topcli/prompts');
    const common = { stdin, stdout, signal };

    switch (question.kind) {
        case 'confirm':
            return confirm(question.message, {
                ...common,
                initial: question.options.initial ?? false
            });
        case 'text':
            return text(question.message, {
                ...common,
                ...(question.options.initial === undefined
                    ? {}
                    : { defaultValue: question.options.initial })
            });
        case 'select':
            return select(question.message, {
                ...common,
                choices: question.options.choices.map(toLibraryChoice)
            });
        case 'multiselect':
            return multiselect(question.message, {
                ...common,
                choices: question.options.choices.map(toLibraryChoice),
                preSelectedChoices: question.options.choices
                    .filter((choice) => choice.selected === true)
                    .map((choice) => choice.value)
            });
    }
};

const processStreams = (): PromptStreams => ({ stdin: process.stdin, stdout: process.stdout });

/**
 * Asks a question on the terminal. While it is open, Ctrl+C aborts it through the library's
 * `signal`, and the question ends as a cancellation. The keypress listener is removed, raw mode
 * switched off and stdin paused, whatever happens (a failing question must not keep the process alive).
 */
export const askQuestion: AskQuestionFn = async (question, streams = processStreams()) => {
    const controller = new AbortController();
    const { stdin, stdout } = streams;

    const onKeypress = (_text: string | undefined, key: readline.Key | undefined) => {
        if (isInterrupt(key)) {
            controller.abort();
        }
    };

    readline.emitKeypressEvents(stdin);
    stdin.on('keypress', onKeypress);

    try {
        return {
            kind: 'answered',
            answer: await askWithLibrary(question, streams, controller.signal)
        };
    } catch (error) {
        if (isAbort(error)) {
            // The library's confirm leaves the cursor hidden when it is aborted (seen in a pty).
            stdout.write(SHOW_CURSOR);

            return { kind: 'cancelled' };
        }

        throw error;
    } finally {
        stdin.off('keypress', onKeypress);

        if (stdin.isTTY) {
            stdin.setRawMode(false);
        }

        // Listening for keys put stdin in flowing mode, and a library that throws after it started
        // never gives it back: a flowing stdin keeps the process alive after the error is printed.
        stdin.pause();
    }
};
