import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { GLOBAL_FLAGS_TEXT, UNKNOWN_COMMAND_MAX_IDS } from '../constants.js';
import { art, envelope } from '../test/art.js';
import { commandSource, writeCommand } from '../test/project.js';
import { createTempFolders } from '../test/temp.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const MODE_FLAG = "flags: { mode: { type: 'string', choices: ['a', 'b'] } }";

/** A commands folder with a `db prune` command (an optional arg and two flags) and a few others. */
function newCommands(): string {
    const dir = path.join(folders.make('artemis-hint-'), 'commands');

    writeCommand(
        dir,
        'db/prune',
        commandSource(
            "args: [{ name: 'target' }], flags: { 'older-than': { type: 'string' }, all: { type: 'boolean' }, mode: { type: 'string', choices: ['a', 'b'] } }"
        )
    );

    writeCommand(dir, 'db/reset', commandSource('args: []'));
    writeCommand(dir, 'build', commandSource(MODE_FLAG));

    return dir;
}

const hintOf = async (argv: string[]): Promise<string | undefined> => {
    const result = await art([...argv, '--json'], { commandsDir: newCommands() });

    return (envelope(result) as { hint?: string }).hint;
};

const PRUNE_HINT = `db prune [target] [--older-than <value>] [--all] [--mode <a|b>]. Global: ${GLOBAL_FLAGS_TEXT}`;

describe('usage hints: every usage error of a resolved command', () => {
    test('an unknown flag has the usage and the global flags', async () => {
        expect(await hintOf(['db', 'prune', '--days', '30'])).toBe(PRUNE_HINT);
    });

    test('an extra argument has the hint', async () => {
        expect(await hintOf(['db', 'prune', 'a', 'b'])).toBe(PRUNE_HINT);
    });

    test('a bad flag choice has the hint', async () => {
        expect(await hintOf(['db', 'prune', '--mode', 'c'])).toBe(PRUNE_HINT);
    });

    test('a flag missing its value has the hint', async () => {
        expect(await hintOf(['db', 'prune', '--older-than'])).toBe(PRUNE_HINT);
    });

    test('a missing required argument has the hint', async () => {
        const result = await art(['math', 'add', '1', '--json']);

        expect((envelope(result) as { hint?: string }).hint).toBe(
            `math add <a> <b>. Global: ${GLOBAL_FLAGS_TEXT}`
        );
    });

    test('a bad choice of an argument has the hint', async () => {
        const result = await art(['math', 'pick', 'green', '--json']);

        expect((envelope(result) as { hint?: string }).hint).toContain('math pick [red|blue]');
    });

    test('the hint names --older-than for the issue case, db prune --days 30', async () => {
        expect(await hintOf(['db', 'prune', '--days', '30'])).toContain('--older-than');
    });
});

describe('usage hints: what keeps its own hint or its usage line', () => {
    test('--dry-run on a command without dryRun keeps its own hint', async () => {
        const result = await art(['hello', '--dry-run', '--json']);

        expect((envelope(result) as { hint?: string }).hint).toMatch(/Drop --dry-run/);
    });

    test('--dry-run on a command without dryRun still prints its Usage line in text', async () => {
        expect((await art(['hello', '--dry-run'])).err).toContain('Usage  art hello');
    });

    test('a command error has no usage hint', async () => {
        const result = await art(['boom', '--json']);

        expect((envelope(result) as { hint?: string }).hint).toBeUndefined();
    });
});

describe('usage hints: text mode', () => {
    test('prints the usage as the Hint and no separate Usage line', async () => {
        const { err } = await art(['math', 'add', '1']);

        expect(err).toContain(`Hint: math add <a> <b>. Global: ${GLOBAL_FLAGS_TEXT}`);
        expect(err).not.toContain('Usage  ');
    });
});

describe('usage hints: ctx.invoke', () => {
    test('a nested usage error is a command error with the usage and no global flags', async () => {
        const result = await art(['invokes-badly', '--json']);
        const { hint } = envelope(result) as { hint?: string };

        expect(hint).toBe('Usage: art math add <a> <b>');
    });
});

describe('the unknown-command hint', () => {
    const hintFor = async (argv: string[]): Promise<string | undefined> =>
        (
            envelope(await art([...argv, '--json'], { commandsDir: newCommands() })) as {
                hint?: string;
            }
        ).hint;

    test('a typo close to a command is still "Did you mean"', async () => {
        expect(await hintFor(['biuld'])).toBe('Did you mean "build"?');
    });

    test('words shared with some ids name them, in id order', async () => {
        expect(await hintFor(['prune'])).toBe('Did you mean one of: "db prune"?');
    });

    test('names at most UNKNOWN_COMMAND_MAX_IDS ids', async () => {
        const dir = newCommands();

        ['alpha', 'beta', 'gamma', 'delta'].forEach((topic) =>
            writeCommand(dir, `${topic}/deploy`, commandSource('args: []'))
        );

        const hint = (
            envelope(await art(['deploy', '--json'], { commandsDir: dir })) as {
                hint: string;
            }
        ).hint;

        expect(hint.match(/"[^"]+"/g)).toHaveLength(UNKNOWN_COMMAND_MAX_IDS);
    });

    test('nothing shared points at the brief listing', async () => {
        expect(await hintFor(['zzzzzzzz'])).toBe(
            'Run "art help --json --brief" to see the commands.'
        );
    });

    test('inside a topic it points at that topic', async () => {
        expect(await hintFor(['db', 'zzzzzzzz'])).toBe(
            'Run "art help db --json --brief" to see the commands.'
        );
    });
});
