import { describe, expectTypeOf, test } from 'vitest';

import type { Prompter } from '../models.js';

const runtimeChoices = (names: string[]) => names.map((name) => ({ label: name, value: name }));

describe('ctx.prompt types', () => {
    test('confirm resolves to a boolean', () => {
        expectTypeOf<ReturnType<Prompter['confirm']>>().toEqualTypeOf<Promise<boolean>>();
    });

    test('text resolves to a string', () => {
        expectTypeOf<ReturnType<Prompter['text']>>().toEqualTypeOf<Promise<string>>();
    });

    test('select with literal choices resolves to the union of their values', () => {
        const answer = (prompt: Prompter) =>
            prompt.select('Runner', {
                choices: [
                    { label: 'Node', value: 'node' },
                    { label: 'Deno', value: 'deno' }
                ]
            });

        expectTypeOf(answer).returns.toEqualTypeOf<Promise<'node' | 'deno'>>();
    });

    test('multiselect with literal choices resolves to an array of the union', () => {
        const answer = (prompt: Prompter) =>
            prompt.multiselect('Steps', {
                choices: [
                    { label: 'Build', value: 'build', selected: true },
                    { label: 'Test', value: 'test' }
                ]
            });

        expectTypeOf(answer).returns.toEqualTypeOf<Promise<('build' | 'test')[]>>();
    });

    test('select with choices built at runtime resolves to string', () => {
        const answer = (prompt: Prompter, names: string[]) =>
            prompt.select('Pick', { choices: runtimeChoices(names) });

        expectTypeOf(answer).returns.toEqualTypeOf<Promise<string>>();
    });

    test('multiselect with choices built at runtime resolves to string[]', () => {
        const answer = (prompt: Prompter, names: string[]) =>
            prompt.multiselect('Pick', { choices: runtimeChoices(names) });

        expectTypeOf(answer).returns.toEqualTypeOf<Promise<string[]>>();
    });

    test('select without choices is a type error', () => {
        const ask = (prompt: Prompter) =>
            // @ts-expect-error choices are required
            prompt.select('Runner', {});

        expectTypeOf(ask).toBeFunction();
    });

    test('multiselect without choices is a type error', () => {
        const ask = (prompt: Prompter) =>
            // @ts-expect-error choices are required
            prompt.multiselect('Steps', { hint: 'Pass --yes' });

        expectTypeOf(ask).toBeFunction();
    });

    test('the old prompts-style call is not callable', () => {
        const ask = (prompt: Prompter) =>
            // @ts-expect-error ctx.prompt is an object of four questions, not a function
            prompt({ type: 'confirm', name: 'x', message: 'y' });

        expectTypeOf(ask).toBeFunction();
    });

    test('the only members are the four questions', () => {
        expectTypeOf<keyof Prompter>().toEqualTypeOf<
            'confirm' | 'text' | 'select' | 'multiselect'
        >();
    });
});
