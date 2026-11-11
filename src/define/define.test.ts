import { describe, expect, test } from 'vitest';

import { defineCommand, defineTopic, isCommand, isTopic } from './define.js';
import type { LooseDefineFn } from '../test/models.js';

const run = () => ({ ok: true });

/** What a JavaScript caller can do: hand `defineCommand` anything. */
const defineLoosely = defineCommand as LooseDefineFn;

describe('defineCommand: required parts', () => {
    test('a description is required', () => {
        expect(() => defineLoosely({ run })).toThrow('defineCommand: a description is required');
    });

    test('a run function is required', () => {
        expect(() => defineLoosely({ description: 'x' })).toThrow(
            'defineCommand: a run function is required'
        );
    });

    test('nothing at all is not a definition', () => {
        expect(() => defineLoosely(undefined)).toThrow('defineCommand: a description is required');
    });
});

describe('defineCommand: args', () => {
    test('every arg needs a name', () => {
        expect(() => defineCommand({ description: 'x', run, args: [{ name: '' }] })).toThrow(
            'defineCommand: every arg needs a name'
        );
    });

    test('an arg cannot be required and have a default', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                args: [{ name: 'a', required: true, default: '1' }]
            })
        ).toThrow('defineCommand: arg "a" cannot be required and have a default');
    });

    test('a required arg cannot come after an optional one', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                args: [{ name: 'a' }, { name: 'b', required: true }]
            })
        ).toThrow('defineCommand: required arg "b" cannot come after an optional one');
    });

    test('optional args may follow required ones', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                args: [{ name: 'a', required: true }, { name: 'b' }]
            })
        ).not.toThrow();
    });
});

describe('defineCommand: flags', () => {
    test.each([{ name: 'help' }, { name: 'json' }, { name: 'yes' }])(
        'the flag --$name is reserved',
        ({ name }) => {
            expect(() =>
                defineCommand({ description: 'x', run, flags: { [name]: { type: 'boolean' } } })
            ).toThrow(`defineCommand: flag "--${name}" is reserved by Artemis`);
        }
    );

    test.each([{ short: 'h' }, { short: 'y' }])(
        'the short flag -$short is reserved',
        ({ short }) => {
            expect(() =>
                defineCommand({
                    description: 'x',
                    run,
                    flags: { mine: { type: 'boolean', short } }
                })
            ).toThrow(`defineCommand: short flag "-${short}" is reserved by Artemis`);
        }
    );

    test('a flag needs the type boolean or string', () => {
        expect(() =>
            defineLoosely({ description: 'x', run, flags: { count: { type: 'number' } } })
        ).toThrow('defineCommand: flag "--count" needs type "boolean" or "string"');
    });
});

describe('defineCommand: flags the parser would reject', () => {
    test('a short flag with more than one character is refused', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                flags: { round: { type: 'boolean', short: 'rr' } }
            })
        ).toThrow('defineCommand: short flag "-rr" of "--round" must be a single character');
    });

    test('a string default on a boolean flag is refused', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                flags: { loud: { type: 'boolean', default: 'yes' } }
            })
        ).toThrow('defineCommand: the default of flag "--loud" must be a boolean');
    });

    test('a boolean default on a string flag is refused', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                flags: { name: { type: 'string', default: true } }
            })
        ).toThrow('defineCommand: the default of flag "--name" must be a string');
    });

    test('a repeatable flag needs an array of strings as its default', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                flags: { tag: { type: 'string', multiple: true, default: 'a' } }
            })
        ).toThrow('defineCommand: the default of flag "--tag" must be an array of strings');
    });

    test('a repeatable flag with an array default is fine', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                flags: { tag: { type: 'string', multiple: true, default: ['a'] } }
            })
        ).not.toThrow();
    });

    test('the defaults of the right type are fine', () => {
        expect(() =>
            defineCommand({
                description: 'x',
                run,
                flags: {
                    loud: { type: 'boolean', default: false, short: 'l' },
                    name: { type: 'string', default: 'ana' }
                }
            })
        ).not.toThrow();
    });
});

describe('defineCommand: the result', () => {
    test('defaults are filled in', () => {
        const command = defineCommand({ description: 'x', run });

        expect([command.args, command.flags, command.aliases, command.examples]).toEqual([
            [],
            {},
            [],
            []
        ]);
    });

    test('the result is frozen', () => {
        expect(Object.isFrozen(defineCommand({ description: 'x', run }))).toBe(true);
    });

    test('the result is recognised as a command', () => {
        expect(isCommand(defineCommand({ description: 'x', run }))).toBe(true);
    });

    test('a plain object is not a command', () => {
        expect(isCommand({ description: 'Forgot defineCommand' })).toBe(false);
    });

    test('extra fields pass through untouched', () => {
        const command = defineCommand({ description: 'x', run, step: { order: 3, enabled: true } });

        expect(command.step).toEqual({ order: 3, enabled: true });
    });
});

describe('defineTopic', () => {
    test('a topic keeps its description and is recognised as a topic', () => {
        const topic = defineTopic({ description: 'Arithmetic' });

        expect([topic.description, isTopic(topic)]).toEqual(['Arithmetic', true]);
    });

    test('a topic without a description has an empty one', () => {
        expect(defineTopic().description).toBe('');
    });

    test('a topic is not a command, and a command is not a topic', () => {
        expect([
            isCommand(defineTopic()),
            isTopic(defineCommand({ description: 'x', run }))
        ]).toEqual([false, false]);
    });
});
