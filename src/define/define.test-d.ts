import { describe, expectTypeOf, test } from 'vitest';

import { defineCommand } from './define.js';
import type {
    CommandContext,
    DestructiveFn,
    InferArgs,
    InferFlags,
    NoFlags,
    RunInput
} from '../models.js';

describe('inference: args', () => {
    test('a required arg is a string', () => {
        defineCommand({
            description: 'x',
            args: [{ name: 'a', required: true }],
            run: ({ args }) => expectTypeOf(args.a).toEqualTypeOf<string>()
        });
    });

    test('an optional arg is a string or undefined', () => {
        defineCommand({
            description: 'x',
            args: [{ name: 'a' }],
            run: ({ args }) => expectTypeOf(args.a).toEqualTypeOf<string | undefined>()
        });
    });

    test('an arg with a default is a string', () => {
        defineCommand({
            description: 'x',
            args: [{ name: 'a', default: 'world' }],
            run: ({ args }) => expectTypeOf(args.a).toEqualTypeOf<string>()
        });
    });

    test('an arg with choices is the union of its choices', () => {
        defineCommand({
            description: 'x',
            args: [{ name: 'color', required: true, choices: ['red', 'blue'] }],
            run: ({ args }) => expectTypeOf(args.color).toEqualTypeOf<'red' | 'blue'>()
        });
    });

    test('an optional arg with choices may also be undefined', () => {
        defineCommand({
            description: 'x',
            args: [{ name: 'color', choices: ['red', 'blue'] }],
            run: ({ args }) => expectTypeOf(args.color).toEqualTypeOf<'red' | 'blue' | undefined>()
        });
    });

    test('an arg with a default and choices is the union', () => {
        defineCommand({
            description: 'x',
            args: [{ name: 'color', default: 'red', choices: ['red', 'blue'] }],
            run: ({ args }) => expectTypeOf(args.color).toEqualTypeOf<'red' | 'blue'>()
        });
    });

    test('reading an undeclared arg is a type error', () => {
        defineCommand({
            description: 'x',
            args: [{ name: 'a', required: true }],
            run: ({ args }) => {
                expectTypeOf(args).not.toHaveProperty('b');

                // @ts-expect-error `b` is not declared
                return args.b;
            }
        });
    });

    test('a command with no args has no args to read', () => {
        defineCommand({
            description: 'x',
            run: ({ args }) => {
                expectTypeOf(args).toEqualTypeOf<Record<never, never>>();

                // @ts-expect-error nothing is declared
                return args.anything;
            }
        });
    });
});

describe('inference: flags', () => {
    test('a boolean flag is a boolean or undefined', () => {
        defineCommand({
            description: 'x',
            flags: { shout: { type: 'boolean' } },
            run: ({ flags }) => expectTypeOf(flags.shout).toEqualTypeOf<boolean | undefined>()
        });
    });

    test('a boolean flag with a default is a boolean', () => {
        defineCommand({
            description: 'x',
            flags: { shout: { type: 'boolean', default: false } },
            run: ({ flags }) => expectTypeOf(flags.shout).toEqualTypeOf<boolean>()
        });
    });

    test('a string flag is a string or undefined', () => {
        defineCommand({
            description: 'x',
            flags: { name: { type: 'string' } },
            run: ({ flags }) => expectTypeOf(flags.name).toEqualTypeOf<string | undefined>()
        });
    });

    test('a string flag with a default is a string', () => {
        defineCommand({
            description: 'x',
            flags: { name: { type: 'string', default: 'ana' } },
            run: ({ flags }) => expectTypeOf(flags.name).toEqualTypeOf<string>()
        });
    });

    test('a string flag with choices is the union of its choices', () => {
        defineCommand({
            description: 'x',
            flags: { size: { type: 'string', choices: ['small', 'large'] } },
            run: ({ flags }) =>
                expectTypeOf(flags.size).toEqualTypeOf<'small' | 'large' | undefined>()
        });
    });

    test('a string flag with a default and choices is the union', () => {
        defineCommand({
            description: 'x',
            flags: { size: { type: 'string', default: 'small', choices: ['small', 'large'] } },
            run: ({ flags }) => expectTypeOf(flags.size).toEqualTypeOf<'small' | 'large'>()
        });
    });

    test('a multiple flag is an array of strings or undefined', () => {
        defineCommand({
            description: 'x',
            flags: { tag: { type: 'string', multiple: true } },
            run: ({ flags }) => expectTypeOf(flags.tag).toEqualTypeOf<string[] | undefined>()
        });
    });

    test('a multiple flag with a default is an array of strings', () => {
        defineCommand({
            description: 'x',
            flags: { tag: { type: 'string', multiple: true, default: ['a'] } },
            run: ({ flags }) => expectTypeOf(flags.tag).toEqualTypeOf<string[]>()
        });
    });

    test('a multiple flag with choices is an array of their union', () => {
        defineCommand({
            description: 'x',
            flags: { tag: { type: 'string', multiple: true, choices: ['a', 'b'] } },
            run: ({ flags }) => expectTypeOf(flags.tag).toEqualTypeOf<('a' | 'b')[] | undefined>()
        });
    });

    test('reading an undeclared flag is a type error', () => {
        defineCommand({
            description: 'x',
            flags: { shout: { type: 'boolean' } },
            run: ({ flags }) => {
                expectTypeOf(flags).not.toHaveProperty('loud');

                // @ts-expect-error `loud` is not declared
                return flags.loud;
            }
        });
    });
});

describe('inference: destructive as a function', () => {
    test('a boolean flag it reads is a boolean or undefined', () => {
        defineCommand({
            description: 'x',
            flags: { 'no-prune': { type: 'boolean' } },
            destructive: ({ flags }) => {
                expectTypeOf(flags['no-prune']).toEqualTypeOf<boolean | undefined>();

                return !flags['no-prune'];
            },
            run: () => null
        });
    });

    test('a required arg it reads is a string', () => {
        defineCommand({
            description: 'x',
            args: [{ name: 'target', required: true }],
            destructive: ({ args }) => {
                expectTypeOf(args.target).toEqualTypeOf<string>();

                return args.target === 'db';
            },
            run: () => null
        });
    });

    test('reading a flag that is not declared is a type error', () => {
        defineCommand({
            description: 'x',
            flags: { keep: { type: 'boolean' } },
            destructive: ({ flags }) => {
                expectTypeOf(flags).not.toHaveProperty('other');

                // @ts-expect-error `other` is not declared
                return flags.other === true;
            },
            run: () => null
        });
    });

    test('returning something that is not a boolean is a type error', () => {
        expectTypeOf<DestructiveFn<[], NoFlags>>().returns.toEqualTypeOf<boolean>();

        defineCommand({
            description: 'x',
            // @ts-expect-error the function must return a boolean
            destructive: () => 'yes',
            run: () => null
        });
    });

    test('the definition keeps the function as given', () => {
        const command = defineCommand({
            description: 'x',
            destructive: () => true,
            run: () => null
        });

        expectTypeOf(command.destructive).toExtend<boolean | DestructiveFn<[], NoFlags>>();
    });
});

describe('inference: the exported helpers', () => {
    test('InferArgs derives the args of a declaration', () => {
        type Args = InferArgs<readonly [{ readonly name: 'a'; readonly required: true }]>;

        expectTypeOf<Args>().toEqualTypeOf<{ a: string }>();
    });

    test('InferFlags derives the flags of a declaration', () => {
        type Flags = InferFlags<{ readonly shout: { readonly type: 'boolean' } }>;

        expectTypeOf<Flags>().toEqualTypeOf<{ shout: boolean | undefined }>();
    });

    test('RunInput carries args, flags and the context', () => {
        type Input = RunInput<readonly [], Record<never, never>>;

        expectTypeOf<Input['ctx']>().toEqualTypeOf<CommandContext>();
    });

    test('a definition widened to the base types keeps working', () => {
        defineCommand({
            description: 'x',
            run: ({ ctx }) => expectTypeOf(ctx.json).toEqualTypeOf<boolean>()
        });
    });
});
