import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { art, envelope } from '../test/art.js';
import { BAD_COMMANDS_FIXTURE_DIR } from '../test/constants.js';
import { createTempFolders } from '../test/temp.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const newLog = (): string => path.join(folders.make('artemis-run-flags-'), 'x.log');

describe('run: resolving and running a command', () => {
    test('a top-level file is a command named after the file', async () => {
        const result = await art(['hello']);

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.out.trim()).toBe('hello world');
    });

    test('a folder is a topic: "topic command" runs the file inside it', async () => {
        const result = await art(['math', 'add', '1', '2', '--json']);

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(envelope(result)).toEqual({ ok: true, command: 'math add', result: { sum: 3 } });
    });

    test('"topic:command" is accepted as the same command', async () => {
        const result = await art(['math:add', '2', '3', '--json']);

        expect(envelope(result).result).toEqual({ sum: 5 });
    });

    test('aliases resolve to their command', async () => {
        const result = await art(['m:add', '4', '5', '--json']);

        expect(envelope(result).result).toEqual({ sum: 9 });
    });

    test('files starting with an underscore are not commands', async () => {
        const result = await art(['_helper']);

        expect(result.code).toBe(EXIT_CODE.USAGE);
    });

    test('an unknown command suggests the closest match', async () => {
        const result = await art(['helo']);

        expect(result.code).toBe(EXIT_CODE.USAGE);
        expect(result.err).toMatch(/Did you mean "hello"/);
    });

    test('with --json an unknown command is reported with a null command', async () => {
        const result = await art(['helo', '--json']);

        expect(envelope(result)).toMatchObject({ ok: false, command: null });
    });

    test('a file that does not export a command is skipped with a warning', async () => {
        const result = await art(['good', '--json'], { commandsDir: BAD_COMMANDS_FIXTURE_DIR });

        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.err).toMatch(/oops\.js/);
    });

    test('--quiet hides the warning about a file that did not load', async () => {
        const result = await art(['good', '--quiet'], { commandsDir: BAD_COMMANDS_FIXTURE_DIR });

        expect(result.err).toBe('');
    });
});

describe('run: flags and the command line', () => {
    test('a global flag before the command name works like one after it', async () => {
        const result = await art(['--json', 'math', 'add', '1', '2']);

        expect(envelope(result)).toEqual({ ok: true, command: 'math add', result: { sum: 3 } });
    });

    test('several global flags before the command name all apply', async () => {
        const result = await art(['--json', '--yes', 'confirm'], { interactive: true });

        expect(envelope(result).result).toEqual({ value: true, asked: false });
    });

    test('a global flag alone shows help', async () => {
        const result = await art(['--json']);

        expect(envelope(result)).toMatchObject({ ok: true, command: 'help' });
    });

    test('--help before the command name shows that command help', async () => {
        const result = await art(['--help', 'hello']);

        expect(result.out).toMatch(/art hello \[name\]/);
    });

    test('a flag that is not global before the command name is a usage error', async () => {
        const result = await art(['--bogus']);

        expect(result.code).toBe(EXIT_CODE.USAGE);
        expect(result.err).toMatch(/Unknown option "--bogus"/);
    });

    test('a command flag typed before its command is a usage error with a hint', async () => {
        const result = await art(['--shout', 'hello', '--json']);

        expect(envelope(result)).toMatchObject({
            ok: false,
            hint: 'Flags go after the command: art <command> --shout'
        });
    });

    test('after -- everything is a plain argument, even --json', async () => {
        const result = await art(['echo', '--', '--json']);

        expect(result.out).toBe('--json\n');
    });

    test('--json after -- does not turn on JSON mode for errors either', async () => {
        const result = await art(['nope', '--', '--json']);

        expect(result.err).toMatch(/Unknown command "nope"/);
        expect(result.out).toBe('');
    });
});

describe('run: usage errors', () => {
    test('a missing required arg is a usage error that shows the usage', async () => {
        const result = await art(['math', 'add', '1']);

        expect(result.code).toBe(EXIT_CODE.USAGE);
        expect(result.err).toMatch(/Missing required argument "b"/);
        expect(result.err).toMatch(/art math add <a> <b>/);
    });

    test('a value outside the allowed choices is a usage error that lists them', async () => {
        const result = await art(['math', 'pick', 'green']);

        expect(result.code).toBe(EXIT_CODE.USAGE);
        expect(result.err).toMatch(/red, blue/);
    });

    test('extra positionals are a usage error', async () => {
        const result = await art(['hello', 'a', 'b']);

        expect(result.code).toBe(EXIT_CODE.USAGE);
    });

    test('unknown flags are a usage error', async () => {
        const result = await art(['hello', '--nope']);

        expect(result.code).toBe(EXIT_CODE.USAGE);
    });
});

describe('run: failures and the JSON contract', () => {
    test('a CommandError exits 1 and reports its hint', async () => {
        const result = await art(['math', 'add', 'x', 'y']);

        expect(result.code).toBe(EXIT_CODE.FAILED);
        expect(result.err).toMatch(/Both arguments must be numbers/);
        expect(result.err).toMatch(/Try: math add 1 2/);
    });

    test('with --json an error is a JSON object on stdout', async () => {
        const result = await art(['math', 'add', 'x', 'y', '--json']);

        expect(result.code).toBe(EXIT_CODE.FAILED);

        expect(envelope(result)).toEqual({
            ok: false,
            command: 'math add',
            error: 'Both arguments must be numbers',
            hint: 'Try: math add 1 2'
        });
    });

    test('a plain error is a bug: it exits 1 and shows its stack', async () => {
        const result = await art(['boom']);

        expect(result.code).toBe(EXIT_CODE.FAILED);
        expect(result.err).toMatch(/Error: kaput/);
    });

    test('with --json a plain error is an ok:false object without a hint', async () => {
        const result = await art(['boom', '--json']);

        expect(envelope(result)).toEqual({ ok: false, command: 'boom', error: 'kaput' });
    });

    test('with --json, ctx.log output is suppressed so stdout stays parseable', async () => {
        const result = await art(['hello', '--json']);

        expect(envelope(result)).toEqual({
            ok: true,
            command: 'hello',
            result: { greeting: 'hello world' }
        });
    });

    test('a command that returns nothing prints a null result under --json', async () => {
        const result = await art(['quiet', '--json']);

        expect(envelope(result)).toEqual({ ok: true, command: 'quiet', result: null });
    });
});

describe('run: prompts and nested commands', () => {
    test('prompting when not interactive fails with a hint instead of hanging', async () => {
        const result = await art(['ask']);

        expect(result.code).toBe(EXIT_CODE.FAILED);
        expect(result.err).toMatch(/needs input/);
    });

    test('the hint of a failed prompt names the flag to pass', async () => {
        const result = await art(['ask', '--json']);

        expect(envelope(result).hint).toMatch(/--yes/);
    });

    test('--json never prompts, even in an interactive run', async () => {
        const result = await art(['confirm', '--json'], { interactive: true });

        expect(envelope(result).result).toEqual({ value: true, asked: false });
    });

    test('ctx.invoke runs another command and returns its result', async () => {
        const result = await art(['calls-hello', '--json']);

        expect(envelope(result).result).toEqual({ greeting: 'hello bob' });
    });

    test('ctx.invoke with --help is refused, not run with empty arguments', async () => {
        const result = await art(['invokes-help', '--json']);

        expect(envelope(result)).toMatchObject({
            ok: false,
            error: 'ctx.invoke("hello"): --help is not something a command can invoke'
        });
    });

    test('a bad ctx.invoke call is the calling command failing, exit 1, not a usage error', async () => {
        const result = await art(['invokes-badly']);

        expect(result.code).toBe(EXIT_CODE.FAILED);
    });

    test('a bad ctx.invoke call says which command and shows its usage', async () => {
        const result = await art(['invokes-badly', '--json']);

        expect(envelope(result)).toMatchObject({
            error: 'ctx.invoke("math add"): Missing required argument "b"',
            hint: 'Usage: art math add <a> <b>'
        });
    });
});

describe('run: the global flags --dry-run, --quiet and --log', () => {
    test('--log before and after the command parse the same', async () => {
        const file = newLog();
        const before = await art(['--log', file, 'hello', '--json']);
        const after = await art(['hello', '--log', file, '--json']);

        expect(envelope(before).result).toEqual(envelope(after).result);
    });

    test('--log=file before the command is accepted', async () => {
        expect((await art([`--log=${newLog()}`, 'hello'])).code).toBe(EXIT_CODE.OK);
    });

    test('a topic does not take --log: nothing would be written', async () => {
        expect((await art(['math', '--log', newLog()])).code).toBe(EXIT_CODE.USAGE);
    });

    test('a topic does not take --dry-run either', async () => {
        expect((await art(['math', '--dry-run'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('--log --json is a usage error that comes out as the object asked for', async () => {
        expect(envelope(await art(['hello', '--log', '--json'])).ok).toBe(false);
    });

    test('--log with no value is a usage error', async () => {
        expect((await art(['hello', '--log'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('--log followed by a word that would be a command is a usage error, not a command', async () => {
        expect((await art(['--log', 'hello'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('the help word does not take --log', async () => {
        expect((await art(['help', '--log', 'x.log'])).code).toBe(EXIT_CODE.USAGE);
    });
});
