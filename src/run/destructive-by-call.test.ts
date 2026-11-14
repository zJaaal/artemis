import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
    CANCELLED_MESSAGE,
    DESTRUCTIVE_BY_CALL_NOTE,
    DESTRUCTIVE_CONFIRM_HINT,
    EXIT_CODE
} from '../constants.js';
import type { Manifest } from '../models.js';
import { art, envelope } from '../test/art.js';
import { commandSource, writeCommand } from '../test/project.js';
import { createTempFolders } from '../test/temp.js';

type PromptsFake = { calls: string[]; answer: boolean };

// The fake stands in for `@topcli/prompts`, which needs a real terminal.
const fake = vi.hoisted<PromptsFake>(() => ({ calls: [], answer: false }));

vi.mock('@topcli/prompts', () => {
    const unused = () => Promise.reject(new Error('only confirm is asked here'));

    return {
        multiselect: unused,
        question: unused,
        select: unused,
        confirm: (message: string) => {
            fake.calls.push(message);

            return Promise.resolve(fake.answer);
        }
    };
});

const folders = createTempFolders();

beforeEach(() => {
    fake.calls = [];
    fake.answer = false;
});

afterEach(() => folders.cleanUp());

/** `dotcms start`: it deletes the data unless --no-prune says to keep it. */
const START = `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Start it (data is pruned unless --no-prune)',
    destructive: ({ flags }) => !flags['no-prune'],
    dryRun: true,
    flags: { 'no-prune': { type: 'boolean', description: 'Keep the data' } },
    run({ flags, ctx }) {
        ctx.plan('start it');

        return { pruned: !flags['no-prune'] };
    }
});
`;

const INVOKES_START = `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Starts it, keeping the data',
    run({ ctx }) {
        return ctx.invoke('start', ['--no-prune']);
    }
});
`;

const INVOKES_START_PRUNING = `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Starts it, pruning the data',
    run({ ctx }) {
        return ctx.invoke('start');
    }
});
`;

const project = (): string => {
    const commandsDir = folders.make('artemis-destructive-');

    writeCommand(commandsDir, 'start', START);
    writeCommand(commandsDir, 'start-keeping', INVOKES_START);
    writeCommand(commandsDir, 'start-pruning', INVOKES_START_PRUNING);

    writeCommand(
        commandsDir,
        'throws',
        commandSource(
            `destructive: () => { throw new Error('the function is broken'); }, dryRun: true`
        )
    );

    writeCommand(commandsDir, 'says-yes', commandSource(`destructive: () => 'yes'`));

    writeCommand(
        commandsDir,
        'by-arg',
        `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Destructive for one target only',
    destructive: ({ args }) => args.target === 'db',
    args: [{ name: 'target', default: 'cache' }],
    run: ({ args }) => ({ target: args.target })
});
`
    );

    return commandsDir;
};

describe('destructive as a function: the answer decides the confirmation', () => {
    test('true is refused with --json and nobody to answer, with the --yes hint', async () => {
        const result = await art(['start', '--json'], { commandsDir: project() });

        expect(envelope(result)).toMatchObject({
            ok: false,
            command: 'start',
            hint: expect.stringContaining(DESTRUCTIVE_CONFIRM_HINT)
        });
    });

    test('true exits 1 when nobody can answer', async () => {
        expect((await art(['start', '--json'], { commandsDir: project() })).code).toBe(
            EXIT_CODE.FAILED
        );
    });

    test('false runs without --yes', async () => {
        const result = await art(['start', '--no-prune', '--json'], { commandsDir: project() });

        expect(envelope(result).result).toEqual({ pruned: false });
    });

    test('true with --yes runs', async () => {
        const result = await art(['start', '--yes', '--json'], { commandsDir: project() });

        expect(envelope(result).result).toEqual({ pruned: true });
    });

    test('true in a terminal asks the question once', async () => {
        fake.answer = true;

        await art(['start'], { commandsDir: project(), interactive: true });

        expect(fake.calls).toHaveLength(1);
    });

    test('true in a terminal and "yes" runs it', async () => {
        fake.answer = true;

        const result = await art(['start'], { commandsDir: project(), interactive: true });

        expect(result.code).toBe(EXIT_CODE.OK);
    });

    test('true in a terminal and "no" is Cancelled.', async () => {
        const result = await art(['start'], { commandsDir: project(), interactive: true });

        expect(result.err).toContain(CANCELLED_MESSAGE);
    });

    test('false in a terminal asks nothing', async () => {
        await art(['start', '--no-prune'], { commandsDir: project(), interactive: true });

        expect(fake.calls).toEqual([]);
    });

    test('it sees the parsed args, defaults applied', async () => {
        const commandsDir = project();

        expect((await art(['by-arg', '--json'], { commandsDir })).code).toBe(EXIT_CODE.OK);
    });

    test('and an arg that makes it true is refused', async () => {
        expect((await art(['by-arg', 'db', '--json'], { commandsDir: project() })).code).toBe(
            EXIT_CODE.FAILED
        );
    });
});

describe('destructive as a function: --dry-run', () => {
    test('asks nothing and plans, even when the answer is true', async () => {
        const result = await art(['start', '--dry-run', '--json'], { commandsDir: project() });

        expect(envelope(result)).toMatchObject({ ok: true, dryRun: true, plan: ['start it'] });
    });

    test('is still called: a function that throws fails a dry run too', async () => {
        const result = await art(['throws', '--dry-run'], { commandsDir: project() });

        expect(result.code).toBe(EXIT_CODE.FAILED);
    });
});

describe('destructive as a function: a bug in the function', () => {
    test('a throw fails the call before run, with its own message', async () => {
        const result = await art(['throws', '--yes', '--json'], { commandsDir: project() });

        expect(envelope(result)).toMatchObject({ ok: false, error: 'the function is broken' });
    });

    test('a throw is exit 1', async () => {
        expect((await art(['throws', '--yes'], { commandsDir: project() })).code).toBe(
            EXIT_CODE.FAILED
        );
    });

    test('a function that does not return a boolean is a TypeError that says what it returned', async () => {
        const result = await art(['says-yes', '--yes', '--json'], { commandsDir: project() });

        expect(envelope(result)).toMatchObject({
            ok: false,
            error: 'destructive() of "says-yes" returned yes; it must return true or false'
        });
    });
});

describe('destructive as a function: ctx.invoke', () => {
    test('the invoked command gets its own flags: --no-prune makes it false', async () => {
        const result = await art(['start-keeping', '--json'], { commandsDir: project() });

        expect(envelope(result).result).toEqual({ pruned: false });
    });

    test('and its own args and flags make it true: the caller needs --yes', async () => {
        const result = await art(['start-pruning', '--json'], { commandsDir: project() });

        expect(envelope(result)).toMatchObject({
            ok: false,
            hint: expect.stringContaining(DESTRUCTIVE_CONFIRM_HINT)
        });
    });

    test('with the caller --yes it runs', async () => {
        const result = await art(['start-pruning', '--yes', '--json'], { commandsDir: project() });

        expect(envelope(result).result).toEqual({ pruned: true });
    });
});

describe('destructive as a function: how it is described', () => {
    const manifestOf = async (): Promise<Manifest> =>
        envelope(await art(['help', '--json'], { commandsDir: project() })).result as Manifest;

    test('the manifest says destructive: true', async () => {
        const start = (await manifestOf()).commands.find((command) => command.id === 'start');

        expect(start).toMatchObject({ destructive: true, dryRun: true });
    });

    test('and has no new key for it', async () => {
        const start = (await manifestOf()).commands.find((command) => command.id === 'start');

        expect(Object.keys(start ?? {}).slice(-2)).toEqual(['destructive', 'dryRun']);
    });

    test('the brief listing marks it destructive', async () => {
        const result = await art(['help', '--brief', '--json'], { commandsDir: project() });

        const brief = envelope(result).result as { commands: { id: string; destructive?: true }[] };

        expect(brief.commands.find((command) => command.id === 'start')?.destructive).toBe(true);
    });

    test('text help prints the Destructive line and says it depends on the call', async () => {
        const result = await art(['start', '--help'], { commandsDir: project() });

        expect(result.out).toContain(DESTRUCTIVE_BY_CALL_NOTE);
    });

    test('text help of a command with plain true has no such note', async () => {
        const commandsDir = project();

        writeCommand(commandsDir, 'plain', commandSource('destructive: true'));

        expect((await art(['plain', '--help'], { commandsDir })).out).not.toContain(
            DESTRUCTIVE_BY_CALL_NOTE
        );
    });
});
