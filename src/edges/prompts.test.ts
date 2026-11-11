import { beforeEach, describe, expect, test, vi } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import type { PromptsCallbacks, PromptsFake } from '../test/models.js';

// The fake stands in for the `prompts` package, which needs a real terminal. Its factory runs only
// when the module is first imported, so `loads` shows whether anything asked for it.
const fake = vi.hoisted<PromptsFake>(() => ({ loads: 0, answers: {}, cancel: false }));

vi.mock('prompts', () => {
    fake.loads += 1;

    return {
        default: (_questions: unknown, { onCancel }: PromptsCallbacks) => {
            if (fake.cancel) {
                onCancel();
            }

            return Promise.resolve(fake.answers);
        }
    };
});

beforeEach(() => {
    vi.resetModules();
    fake.loads = 0;
    fake.answers = {};
    fake.cancel = false;
});

/** A fresh copy of the CLI, so each test starts with `prompts` not loaded. */
const freshArt = () => import('../test/art.js');

describe('the prompts edge', () => {
    test('prompts is not loaded when no command prompts', async () => {
        const { art } = await freshArt();

        await art(['hello'], { interactive: true });

        expect(fake.loads).toBe(0);
    });

    test('--yes never prompts, even in an interactive run', async () => {
        const { art, envelope } = await freshArt();
        const result = await art(['confirm', '--yes', '--json'], { interactive: true });

        expect(envelope(result).result).toEqual({ value: true, asked: false });
        expect(fake.loads).toBe(0);
    });

    test('a command that asks while not interactive fails without loading prompts', async () => {
        const { art, envelope } = await freshArt();
        const result = await art(['ask', '--json']);

        expect(envelope(result)).toMatchObject({
            ok: false,
            hint: 'Pass --yes to skip the question.'
        });

        expect(fake.loads).toBe(0);
    });

    test('prompts is loaded when an interactive command asks', async () => {
        fake.answers = { value: false };

        const { art } = await freshArt();

        await art(['confirm'], { interactive: true });

        expect(fake.loads).toBe(1);
    });

    test('the answers come back to the command', async () => {
        fake.answers = { value: false };

        const { art } = await freshArt();
        const result = await art(['confirm'], { interactive: true });

        expect(JSON.parse(result.out)).toEqual({ value: false, asked: true });
    });

    test('a cancelled prompt is a failed command', async () => {
        fake.cancel = true;

        const { art } = await freshArt();
        const result = await art(['confirm'], { interactive: true });

        expect(result.code).toBe(EXIT_CODE.FAILED);
        expect(result.err).toContain('Cancelled.');
    });

    test('--json never prompts either, so stdout stays one JSON object', async () => {
        const { art, envelope } = await freshArt();
        const result = await art(['confirm', '--json'], { interactive: true });

        expect(envelope(result).result).toEqual({ value: true, asked: false });
        expect(fake.loads).toBe(0);
    });
});
