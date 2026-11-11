import { beforeAll, describe, expect, test } from 'vitest';

import { createContext } from './context.js';
import { ASKS_REGARDLESS_HINT, EXIT_CODE, NOT_INTERACTIVE_HINT } from '../constants.js';
import { discover } from '../discover/discover.js';
import { CommandError } from '../errors/errors.js';
import type {
    CommandContext,
    ContextParts,
    GlobalFlags,
    PromptOptions,
    Registry
} from '../models.js';
import { COMMANDS_FIXTURE_DIR } from '../test/constants.js';
import { createSink } from '../test/sink.js';

const quietFlags: GlobalFlags = { help: false, json: false, yes: false };

let registry: Registry;

beforeAll(async () => {
    registry = await discover(COMMANDS_FIXTURE_DIR);
});

const setUp = (overrides: Partial<ContextParts> = {}) => {
    const stdout = createSink();
    const stderr = createSink();

    const style = {
        bold: String,
        dim: String,
        red: String,
        green: String,
        yellow: String,
        cyan: String
    };

    const ctx = createContext({
        io: { stdout, stderr },
        global: quietFlags,
        interactive: false,
        style,
        registry,
        invoke: () => Promise.resolve(undefined),
        ...overrides
    });

    return { ctx, stdout, stderr };
};

describe('ctx.log and ctx.warn', () => {
    test('log writes formatted text and a newline to stdout', () => {
        const { ctx, stdout } = setUp();

        ctx.log('hello %s', 'ana');

        expect(stdout.text).toBe('hello ana\n');
    });

    test('log is suppressed under --json, so stdout stays parseable', () => {
        const { ctx, stdout } = setUp({ global: { ...quietFlags, json: true } });

        ctx.log('hello');

        expect(stdout.text).toBe('');
    });

    test('warn writes to stderr', () => {
        const { ctx, stderr } = setUp();

        ctx.warn('careful');

        expect(stderr.text).toBe('careful\n');
    });

    test('warn still writes under --json, and never to stdout', () => {
        const { ctx, stdout, stderr } = setUp({ global: { ...quietFlags, json: true } });

        ctx.warn('careful');

        expect([stdout.text, stderr.text]).toEqual(['', 'careful\n']);
    });
});

describe('ctx fields', () => {
    test('json and interactive come from how the command runs', () => {
        const { ctx } = setUp({ global: { ...quietFlags, json: true }, interactive: true });

        expect([ctx.json, ctx.interactive]).toEqual([true, true]);
    });

    test('commands lists every discovered command', () => {
        const { ctx } = setUp();

        expect(ctx.commands.map((entry) => entry.id)).toContain('math add');
    });

    test('invoke is the function it was given', async () => {
        const { ctx } = setUp({ invoke: (id) => Promise.resolve(`ran ${id}`) });

        expect(await ctx.invoke('hello')).toBe('ran hello');
    });
});

const CHOICES = [
    { label: 'Node', value: 'node' },
    { label: 'Deno', value: 'deno' }
] as const;

/** Each of the four questions, asked the same way, so each is tested on its own. */
const QUESTIONS: {
    method: string;
    ask: (ctx: CommandContext, options: PromptOptions) => Promise<unknown>;
}[] = [
    { method: 'confirm', ask: (ctx, options) => ctx.prompt.confirm('Sure?', options) },
    { method: 'text', ask: (ctx, options) => ctx.prompt.text('Name?', options) },
    {
        method: 'select',
        ask: (ctx, options) => ctx.prompt.select('Runner?', { ...options, choices: CHOICES })
    },
    {
        method: 'multiselect',
        ask: (ctx, options) => ctx.prompt.multiselect('Runners?', { ...options, choices: CHOICES })
    }
];

describe('ctx.prompt has exactly four questions', () => {
    test('confirm, text, select and multiselect', () => {
        const { ctx } = setUp();

        expect(Object.keys(ctx.prompt).sort()).toEqual([
            'confirm',
            'multiselect',
            'select',
            'text'
        ]);
    });
});

describe('ctx.prompt when nobody can answer', () => {
    test.each(QUESTIONS)(
        '$method throws a CommandError instead of waiting forever',
        async ({ ask }) => {
            const { ctx } = setUp();

            await expect(ask(ctx, {})).rejects.toBeInstanceOf(CommandError);
        }
    );

    test.each(QUESTIONS)('$method says the command needs input', async ({ ask }) => {
        const { ctx } = setUp();

        await expect(ask(ctx, {})).rejects.toThrow(
            'This command needs input, but it is not running interactively.'
        );
    });

    test.each(QUESTIONS)(
        '$method has a default hint that tells the caller to pass the flags that answer',
        async ({ ask }) => {
            const { ctx } = setUp();

            await expect(ask(ctx, {})).rejects.toMatchObject({ hint: NOT_INTERACTIVE_HINT });
        }
    );

    test.each(QUESTIONS)(
        '$method says the command asks regardless when --yes was passed, not to pass --yes again',
        async ({ ask }) => {
            const { ctx } = setUp({ global: { ...quietFlags, yes: true } });

            await expect(ask(ctx, {})).rejects.toMatchObject({ hint: ASKS_REGARDLESS_HINT });
        }
    );

    test.each(QUESTIONS)(
        '$method says the command asks regardless when --json was passed',
        async ({ ask }) => {
            const { ctx } = setUp({ global: { ...quietFlags, json: true } });

            await expect(ask(ctx, {})).rejects.toMatchObject({ hint: ASKS_REGARDLESS_HINT });
        }
    );

    test.each(QUESTIONS)(
        "$method keeps the command's own hint even when --yes was passed",
        async ({ ask }) => {
            const { ctx } = setUp({ global: { ...quietFlags, yes: true } });

            await expect(ask(ctx, { hint: 'Pass --branch.' })).rejects.toMatchObject({
                hint: 'Pass --branch.'
            });
        }
    );

    test.each(QUESTIONS)(
        '$method takes the hint from the command when it has one',
        async ({ ask }) => {
            const { ctx } = setUp();

            await expect(ask(ctx, { hint: 'Pass --yes to accept.' })).rejects.toMatchObject({
                hint: 'Pass --yes to accept.'
            });
        }
    );

    test.each(QUESTIONS)('$method fails with an expected error that exits 1', async ({ ask }) => {
        const { ctx } = setUp();

        const error = await ask(ctx, {}).catch((caught: unknown) => caught);

        expect(error).toMatchObject({ exitCode: EXIT_CODE.FAILED });
    });
});
