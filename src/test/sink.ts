import type { Sink } from './models.js';

/** Collects what a command writes, so a test can assert on it. */
export const createSink = (): Sink => {
    let text = '';

    return {
        write: (chunk) => {
            text += chunk;

            return true;
        },
        get text() {
            return text;
        }
    };
};
