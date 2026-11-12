import { describe, expect, test } from 'vitest';

import { DRY_RUN_EMPTY, EXIT_CODE } from '../constants.js';
import { art, envelope } from '../test/art.js';

describe('run: --dry-run on a command that does not support it', () => {
    test('is a usage error', async () => {
        expect((await art(['hello', '--dry-run'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('names the command', async () => {
        expect((await art(['hello', '--dry-run'])).err).toMatch(/hello does not support --dry-run/);
    });

    test('never calls run', async () => {
        const run = await art(['purge', '--dry-run', '--yes']);

        expect(run.code).toBe(EXIT_CODE.USAGE);
        expect(run.err).toMatch(/purge does not support --dry-run/);
        expect(run.out).not.toMatch(/purged/);
    });
});

describe('run: --dry-run on a command that supports it', () => {
    test('asks nothing even though the command is destructive', async () => {
        const result = await art(['wipe', '--dry-run']);

        expect(result.code).toBe(EXIT_CODE.OK);
    });

    test('ctx.dryRun is true and the command reports and changes nothing', async () => {
        expect(envelope(await art(['wipe', '--dry-run', '--json'])).result).toEqual({
            wiped: false
        });
    });

    test('the envelope has dryRun: true and the plan after the result', async () => {
        const result = await art(['wipe', '--dry-run', '--json']);

        expect(envelope(result)).toEqual({
            ok: true,
            command: 'wipe',
            result: { wiped: false },
            dryRun: true,
            plan: ['remove the data folder']
        });
    });

    test('the keys come in their fixed order', async () => {
        expect(Object.keys(envelope(await art(['wipe', '--dry-run', '--json'])))).toEqual([
            'ok',
            'command',
            'result',
            'dryRun',
            'plan'
        ]);
    });

    test('in text mode the plan is printed as a list after the output', async () => {
        expect((await art(['wipe', '--dry-run'])).out).toMatch(
            /It would:\n {2}- remove the data folder/
        );
    });

    test('a real run has no dryRun or plan key', async () => {
        const result = await art(['wipe', '--yes', '--json']);

        expect(envelope(result)).toEqual({
            ok: true,
            command: 'wipe',
            result: { wiped: true }
        });
    });

    test('ctx.plan outside --dry-run collects nothing', async () => {
        const result = envelope(await art(['wipe', '--yes', '--json']));

        expect(result).toMatchObject({ ok: true, result: { wiped: true } });
        expect(result).not.toHaveProperty('plan');
    });

    test('the plan is still printed under --quiet', async () => {
        expect((await art(['wipe', '--dry-run', '--quiet'])).out).toMatch(/remove the data folder/);
    });
});

describe('run: ctx.invoke under --dry-run', () => {
    test('a dry-runnable command is invoked with --dry-run and its steps are appended to the plan', async () => {
        expect(envelope(await art(['wipes-twice', '--dry-run', '--json'])).plan).toEqual([
            'stop the instance',
            'remove the data folder'
        ]);
    });

    test('a command without dry-run support fails the caller with exit 1', async () => {
        expect((await art(['dry-calls-hello', '--dry-run'])).code).toBe(EXIT_CODE.FAILED);
    });

    test('and it is never run', async () => {
        const run = await art(['dry-calls-hello', '--dry-run']);

        expect(run.code).toBe(EXIT_CODE.FAILED);
        expect(run.err).toMatch(/does not support --dry-run/);
        expect(run.out).not.toMatch(/hello world/);
    });
});

describe('run: a dry run with nothing planned', () => {
    test('prints Nothing to do. in text mode', async () => {
        expect((await art(['dry-noop', '--dry-run'])).out).toMatch(DRY_RUN_EMPTY);
    });

    test('has an empty plan in the envelope, so a dry run is always recognizable', async () => {
        expect(envelope(await art(['dry-noop', '--dry-run', '--json'])).plan).toEqual([]);
    });
});
