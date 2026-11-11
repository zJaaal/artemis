import { beforeAll, describe, expect, test } from 'vitest';

import { createContext } from './context.js';
import { EXIT_CODE, NOT_INTERACTIVE_HINT } from '../constants.js';
import { discover } from '../discover/discover.js';
import { CommandError } from '../errors/errors.js';
import type { ContextParts, GlobalFlags, Registry } from '../models.js';
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

describe('ctx.prompt when nobody can answer', () => {
    test('throws a CommandError instead of waiting forever', async () => {
        const { ctx } = setUp();

        await expect(
            ctx.prompt({ type: 'confirm', name: 'ok', message: 'Sure?' })
        ).rejects.toBeInstanceOf(CommandError);
    });

    test('says the command needs input', async () => {
        const { ctx } = setUp();

        await expect(ctx.prompt({ type: 'confirm', name: 'ok', message: 'Sure?' })).rejects.toThrow(
            'This command needs input, but it is not running interactively.'
        );
    });

    test('the default hint tells the caller to pass the flags that answer', async () => {
        const { ctx } = setUp();
        const failure = ctx.prompt({ type: 'confirm', name: 'ok', message: 'Sure?' });

        await expect(failure).rejects.toMatchObject({ hint: NOT_INTERACTIVE_HINT });
    });

    test('a hint from the command replaces the default', async () => {
        const { ctx } = setUp();

        const failure = ctx.prompt(
            { type: 'confirm', name: 'ok', message: 'Sure?' },
            { hint: 'Pass --yes to accept.' }
        );

        await expect(failure).rejects.toMatchObject({ hint: 'Pass --yes to accept.' });
    });

    test('the failure is an expected one that exits 1', async () => {
        const { ctx } = setUp();

        const error = await ctx
            .prompt({ type: 'confirm', name: 'ok', message: 'Sure?' })
            .catch((caught: unknown) => caught);

        expect(error).toMatchObject({ exitCode: EXIT_CODE.FAILED });
    });
});
