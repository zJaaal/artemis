import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
    CANCELLED_MESSAGE,
    DESTRUCTIVE_CONFIRM_HINT,
    DRY_RUN_FIRST_HINT,
    EXIT_CODE
} from '../constants.js';
import type { DestructiveCall } from '../models.js';
import { art, envelope } from '../test/art.js';
import { confirmDestructive, planDestructive } from './destructive.js';

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

beforeEach(() => {
    fake.calls = [];
    fake.answer = false;
});

const call: DestructiveCall = {
    bin: 'art',
    id: 'wipe',
    destructive: true,
    supportsDryRun: true,
    dryRun: false,
    yes: false,
    interactive: false
};

describe('planDestructive', () => {
    test('a command that is not destructive just runs', () => {
        expect(planDestructive({ ...call, destructive: false })).toBe('run');
    });

    test('--dry-run asks nothing, because nothing will be changed', () => {
        expect(planDestructive({ ...call, dryRun: true, interactive: true })).toBe('run');
    });

    test('--yes runs it', () => {
        expect(planDestructive({ ...call, yes: true })).toBe('run');
    });

    test('with someone to answer it asks', () => {
        expect(planDestructive({ ...call, interactive: true })).toBe('ask');
    });

    test('with nobody to answer and no --yes it is refused', () => {
        expect(planDestructive(call)).toBe('refuse');
    });
});

describe('confirmDestructive', () => {
    test('a refusal names the command and says how to confirm and how to preview', async () => {
        await expect(confirmDestructive(call)).rejects.toMatchObject({
            message: 'art wipe changes or deletes data',
            hint: `${DESTRUCTIVE_CONFIRM_HINT} ${DRY_RUN_FIRST_HINT}`
        });
    });

    test('a refusal of a command without dry-run support gives only the --yes hint', async () => {
        await expect(confirmDestructive({ ...call, supportsDryRun: false })).rejects.toMatchObject({
            hint: DESTRUCTIVE_CONFIRM_HINT
        });
    });

    test('"no" at the question is a cancelled error', async () => {
        await expect(confirmDestructive({ ...call, interactive: true })).rejects.toMatchObject({
            message: CANCELLED_MESSAGE
        });
    });

    test('"yes" at the question lets it run', async () => {
        fake.answer = true;

        await expect(confirmDestructive({ ...call, interactive: true })).resolves.toBeUndefined();
    });
});

describe('run: a destructive command', () => {
    test('without --yes and with nobody to answer it exits 1 before run, with both hints', async () => {
        const result = await art(['wipe', '--json']);

        expect(envelope(result)).toMatchObject({
            ok: false,
            command: 'wipe',
            hint: `${DESTRUCTIVE_CONFIRM_HINT} ${DRY_RUN_FIRST_HINT}`
        });

        expect(result.code).toBe(EXIT_CODE.FAILED);
    });

    test('run is not called when it is refused', async () => {
        expect((await art(['purge'])).out).not.toMatch(/purged/);
    });

    test('a command without dry-run support is refused with only the --yes hint', async () => {
        expect(envelope(await art(['purge', '--json']))).toMatchObject({
            hint: DESTRUCTIVE_CONFIRM_HINT
        });
    });

    test('with --yes it runs', async () => {
        expect((await art(['purge', '--yes'])).out.trim()).toBe('purged');
    });

    test('in a terminal it asks, and yes runs it', async () => {
        fake.answer = true;

        const result = await art(['purge'], { interactive: true });

        expect(result.out.trim()).toBe('purged');
    });

    test('in a terminal "no" exits 1 with Cancelled.', async () => {
        const result = await art(['purge'], { interactive: true });

        expect(result.err).toMatch(/Cancelled\./);
    });

    test('--json is never asked, even in a terminal', async () => {
        const result = await art(['purge', '--json'], { interactive: true });

        expect(fake.calls).toEqual([]);
        expect(result.code).toBe(EXIT_CODE.FAILED);
    });

    test('a bad argument on a destructive command is a usage error and asks nothing', async () => {
        const result = await art(['purge', 'extra'], { interactive: true });

        expect(result.code).toBe(EXIT_CODE.USAGE);
        expect(fake.calls).toEqual([]);
    });

    test('--help on a destructive command asks nothing', async () => {
        const result = await art(['purge', '--help'], { interactive: true });

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(fake.calls).toEqual([]);
    });
});

describe('ctx.invoke of a destructive command', () => {
    test('without the caller --yes it fails the caller, because a confirmation covers one command', async () => {
        const result = await art(['invokes-purge', '--json']);

        expect(envelope(result)).toMatchObject({
            ok: false,
            hint: DESTRUCTIVE_CONFIRM_HINT
        });
    });

    test('with the caller --yes it passes the --yes along and runs', async () => {
        expect(envelope(await art(['invokes-purge', '--yes', '--json'])).result).toEqual({
            purged: true
        });
    });
});
