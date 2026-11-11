import type { AskFn } from '../models.js';

// Edge: the only place `prompts` is loaded, and only when a command really asks.
export const askQuestions: AskFn = async (questions) => {
    const { default: prompts } = await import('prompts');
    let cancelled = false;

    const answers = await prompts(questions, {
        // Returning true keeps asking the remaining questions, as the JS version did; the caller
        // turns the cancellation into an error afterwards.
        onCancel: () => {
            cancelled = true;

            return true;
        }
    });

    return { answers, cancelled };
};
