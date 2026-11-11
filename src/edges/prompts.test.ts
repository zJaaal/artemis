import readline from 'node:readline';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { EXIT_CODE, SHOW_CURSOR } from '../constants.js';
import { PROMPTS_FIXTURE_DIR } from '../test/constants.js';
import type { PromptsFake } from '../test/models.js';
import { createFakeTty } from '../test/tty.js';

// The fake stands in for `@topcli/prompts`, which needs a real terminal. Its factory runs only
// when the module is first imported, so `loads` shows whether anything asked for it.
const fake = vi.hoisted<PromptsFake>(() => ({
    loads: 0,
    calls: [],
    answer: undefined,
    abort: false,
    waitForSignal: false,
    failure: undefined
}));

vi.mock('@topcli/prompts', () => {
    fake.loads += 1;

    const abortError = () =>
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

    const answerFor =
        (fn: string) =>
        (message: string, options: Record<string, unknown> = {}) => {
            fake.calls.push({ fn, message, options });

            const signal = options.signal as AbortSignal;

            if (fake.waitForSignal) {
                return new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(abortError()));
                });
            }

            if (fake.failure) {
                return Promise.reject(fake.failure);
            }

            return fake.abort ? Promise.reject(abortError()) : Promise.resolve(fake.answer);
        };

    return {
        confirm: answerFor('confirm'),
        question: answerFor('question'),
        select: answerFor('select'),
        multiselect: answerFor('multiselect')
    };
});

beforeEach(() => {
    vi.resetModules();
    fake.loads = 0;
    fake.calls = [];
    fake.answer = undefined;
    fake.abort = false;
    fake.waitForSignal = false;
    fake.failure = undefined;
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** A fresh copy of the CLI, so each test starts with the package not loaded. */
const freshArt = () => import('../test/art.js');

/** A fresh copy of the edge, for tests that talk to it directly. */
const freshEdge = () => import('./prompts.js');

const CTRL_C = '\u0003';

describe('the prompts edge in a run', () => {
    test('the package is not loaded when no command prompts', async () => {
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

    test('a command that asks while not interactive fails without loading the package', async () => {
        const { art, envelope } = await freshArt();
        const result = await art(['ask', '--json']);

        expect(envelope(result)).toMatchObject({
            ok: false,
            hint: 'Pass --yes to skip the question.'
        });

        expect(fake.loads).toBe(0);
    });

    test('the package is loaded when an interactive command asks', async () => {
        fake.answer = false;

        const { art } = await freshArt();

        await art(['confirm'], { interactive: true });

        expect(fake.loads).toBe(1);
    });

    test('the answer comes back to the command', async () => {
        fake.answer = false;

        const { art } = await freshArt();
        const result = await art(['confirm'], { interactive: true });

        expect(JSON.parse(result.out)).toEqual({ value: false, asked: true });
    });

    test('a cancelled prompt is a failed command', async () => {
        fake.abort = true;

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

describe('each question without anyone to answer, in a run', () => {
    test.each([
        { command: 'ask-confirm' },
        { command: 'ask-text' },
        { command: 'ask-select' },
        { command: 'ask-multiselect' }
    ])('$command fails with the hint and exits 1', async ({ command }) => {
        const { art, envelope } = await freshArt();
        const result = await art([command, '--json'], { commandsDir: PROMPTS_FIXTURE_DIR });

        expect([result.code, envelope(result)]).toEqual([
            EXIT_CODE.FAILED,
            expect.objectContaining({ ok: false, hint: 'Pass --yes to skip the question.' })
        ]);
    });
});

describe('each question answered, in a run', () => {
    test.each([
        { command: 'ask-confirm', typed: false },
        { command: 'ask-text', typed: 'Ada' },
        { command: 'ask-select', typed: 'deno' },
        { command: 'ask-multiselect', typed: ['build', 'test'] }
    ])('$command hands the command what was answered', async ({ command, typed }) => {
        fake.answer = typed;

        const { art } = await freshArt();

        const result = await art([command], {
            commandsDir: PROMPTS_FIXTURE_DIR,
            interactive: true
        });

        expect(JSON.parse(result.out)).toEqual({ answer: typed });
    });

    test('a select answered with something that is not one of its choices is a bug, not an answer', async () => {
        fake.answer = 'bun';

        const { art } = await freshArt();

        const result = await art(['ask-select'], {
            commandsDir: PROMPTS_FIXTURE_DIR,
            interactive: true
        });

        expect(result.code).toBe(EXIT_CODE.FAILED);
    });

    test('a multiselect answered with something that is not one of its choices is a bug, not a shorter list', async () => {
        fake.answer = ['build', 'bun'];

        const { art } = await freshArt();

        const result = await art(['ask-multiselect'], {
            commandsDir: PROMPTS_FIXTURE_DIR,
            interactive: true
        });

        expect(result.code).toBe(EXIT_CODE.FAILED);
    });

    test('a multiselect answer is returned in the order the package gave it', async () => {
        fake.answer = ['test', 'build'];

        const { art } = await freshArt();

        const result = await art(['ask-multiselect'], {
            commandsDir: PROMPTS_FIXTURE_DIR,
            interactive: true
        });

        expect(JSON.parse(result.out)).toEqual({ answer: ['test', 'build'] });
    });
});

describe('each question, mapped onto the package', () => {
    test('confirm passes its message and initial, defaulting to false', async () => {
        fake.answer = true;

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();

        await askWithLibrary(
            { kind: 'confirm', message: 'Sure?', options: {} },
            { stdin, stdout },
            new AbortController().signal
        );

        expect(fake.calls[0]).toMatchObject({
            fn: 'confirm',
            message: 'Sure?',
            options: { initial: false }
        });
    });

    test('confirm passes initial: true on', async () => {
        fake.answer = true;

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();

        await askWithLibrary(
            { kind: 'confirm', message: 'Sure?', options: { initial: true } },
            { stdin, stdout },
            new AbortController().signal
        );

        expect(fake.calls[0]?.options).toMatchObject({ initial: true });
    });

    test('text becomes question, with initial as its defaultValue', async () => {
        fake.answer = 'world';

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();

        await askWithLibrary(
            { kind: 'text', message: 'Name?', options: { initial: 'world' } },
            { stdin, stdout },
            new AbortController().signal
        );

        expect(fake.calls[0]).toMatchObject({
            fn: 'question',
            message: 'Name?',
            options: { defaultValue: 'world' }
        });
    });

    test('text with no initial passes no defaultValue', async () => {
        fake.answer = 'x';

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();

        await askWithLibrary(
            { kind: 'text', message: 'Name?', options: {} },
            { stdin, stdout },
            new AbortController().signal
        );

        expect(fake.calls[0]?.options).not.toHaveProperty('defaultValue');
    });

    test('select passes its choices with label, value and description', async () => {
        fake.answer = 'node';

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();

        await askWithLibrary(
            {
                kind: 'select',
                message: 'Runner?',
                options: {
                    choices: [
                        { label: 'Node', value: 'node', description: 'The default' },
                        { label: 'Deno', value: 'deno' }
                    ]
                }
            },
            { stdin, stdout },
            new AbortController().signal
        );

        expect(fake.calls[0]).toMatchObject({
            fn: 'select',
            options: {
                choices: [
                    { label: 'Node', value: 'node', description: 'The default' },
                    { label: 'Deno', value: 'deno' }
                ]
            }
        });
    });

    test('a choice with no description has no description key', async () => {
        fake.answer = 'deno';

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();

        await askWithLibrary(
            {
                kind: 'select',
                message: 'Runner?',
                options: { choices: [{ label: 'Deno', value: 'deno' }] }
            },
            { stdin, stdout },
            new AbortController().signal
        );

        expect((fake.calls[0]?.options.choices as object[])[0]).not.toHaveProperty('description');
    });

    test('multiselect turns selected into preSelectedChoices', async () => {
        fake.answer = ['build'];

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();

        await askWithLibrary(
            {
                kind: 'multiselect',
                message: 'Steps?',
                options: {
                    choices: [
                        { label: 'Build', value: 'build', selected: true },
                        { label: 'Test', value: 'test' }
                    ]
                }
            },
            { stdin, stdout },
            new AbortController().signal
        );

        expect(fake.calls[0]).toMatchObject({
            fn: 'multiselect',
            options: { preSelectedChoices: ['build'] }
        });
    });

    test('every question gets the stdin, stdout and signal it was given', async () => {
        fake.answer = true;

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();
        const { signal } = new AbortController();

        await askWithLibrary(
            { kind: 'confirm', message: 'Sure?', options: {} },
            { stdin, stdout },
            signal
        );

        expect(fake.calls[0]?.options).toMatchObject({ stdin, stdout, signal });
    });

    test('the answer of the package is returned as it is', async () => {
        fake.answer = ['build', 'test'];

        const { askWithLibrary } = await freshEdge();
        const { stdin, stdout } = createFakeTty();

        const answer = await askWithLibrary(
            {
                kind: 'multiselect',
                message: 'Steps?',
                options: { choices: [{ label: 'Build', value: 'build' }] }
            },
            { stdin, stdout },
            new AbortController().signal
        );

        expect(answer).toEqual(['build', 'test']);
    });
});

describe('askQuestion: cancelling and cleaning up', () => {
    test('an answer is reported as answered', async () => {
        fake.answer = true;

        const { askQuestion } = await freshEdge();

        expect(
            await askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, createFakeTty())
        ).toEqual({
            kind: 'answered',
            answer: true
        });
    });

    test('an error named AbortError is reported as cancelled', async () => {
        fake.abort = true;

        const { askQuestion } = await freshEdge();

        expect(
            await askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, createFakeTty())
        ).toEqual({
            kind: 'cancelled'
        });
    });

    test('Ctrl+C typed on a terminal stdin during a question cancels it', async () => {
        fake.waitForSignal = true;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();
        const outcome = askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty);

        await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
        tty.type(CTRL_C);

        expect(await outcome).toEqual({ kind: 'cancelled' });
    });

    test('a cancelled question leaves the cursor visible, whatever the library did', async () => {
        fake.waitForSignal = true;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();
        const outcome = askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty);

        await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
        tty.type(CTRL_C);
        await outcome;

        expect(tty.written()).toBe(SHOW_CURSOR);
    });

    test('an answered question writes nothing of its own to the terminal', async () => {
        fake.answer = true;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();

        await askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty);

        expect(tty.written()).toBe('');
    });

    test('another key does not cancel it', async () => {
        fake.waitForSignal = true;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();
        const outcome = askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty);
        const settled = vi.fn();

        outcome.then(settled, settled);
        await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
        tty.type('y');
        await new Promise((resolve) => setImmediate(resolve));

        expect(settled).not.toHaveBeenCalled();

        tty.type(CTRL_C);
        await outcome;
    });

    test('the keypress listener is gone after an answer', async () => {
        fake.answer = true;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();

        await askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty);

        expect(tty.keypressListeners()).toBe(0);
    });

    test('the keypress listener is gone after Ctrl+C', async () => {
        fake.waitForSignal = true;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();
        const outcome = askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty);

        await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
        tty.type(CTRL_C);
        await outcome;

        expect(tty.keypressListeners()).toBe(0);
    });

    test('raw mode is switched off when the question ends', async () => {
        fake.answer = true;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();

        await askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty);

        expect(tty.rawModes).toEqual([false]);
    });

    test('stdin is paused after an answer, so it no longer keeps the process alive', async () => {
        fake.answer = true;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();

        await askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty);

        expect(tty.isPaused()).toBe(true);
    });

    test('stdin is paused when the package fails after it started listening', async () => {
        fake.failure = new Error('The package fell over');

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();

        await askQuestion({ kind: 'select', message: 'Pick', options: { choices: [] } }, tty).catch(
            () => undefined
        );

        expect(tty.isPaused()).toBe(true);
    });

    test('the keypress listener is gone when the package fails', async () => {
        fake.failure = new Error('The package fell over');

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();

        await askQuestion({ kind: 'select', message: 'Pick', options: { choices: [] } }, tty).catch(
            () => undefined
        );

        expect(tty.keypressListeners()).toBe(0);
    });

    test('an error that is not an abort is not swallowed, and the listener is still removed', async () => {
        fake.answer = undefined;

        const { askQuestion } = await freshEdge();
        const tty = createFakeTty();

        vi.spyOn(readline, 'emitKeypressEvents').mockImplementation(() => {
            throw new Error('terminal gone');
        });

        await expect(
            askQuestion({ kind: 'confirm', message: 'Sure?', options: {} }, tty)
        ).rejects.toThrow('terminal gone');
    });
});
