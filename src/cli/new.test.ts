import path from 'node:path';

import { format, resolveConfig } from 'prettier';
import { describe, expect, test } from 'vitest';

import { RESERVED_FLAGS } from '../constants.js';
import { UsageError } from '../errors/errors.js';
import type { NewSpec } from '../models.js';
import { thrownBy } from '../test/thrown.js';
import { NEW_USAGE_LINE, WORD_NAMES } from './constants.js';
import { checkNew, commandFile, parseNewWords, renderCommand } from './new.js';

describe('parseNewWords: the words and the flags', () => {
    test('every word that is not a flag is a command word', () => {
        expect(parseNewWords(['db', 'reset']).words).toEqual(['db', 'reset']);
    });

    test('a word is a word wherever it stands: after a flag and its value too', () => {
        expect(parseNewWords(['x', '--arg', 'a', 'y']).words).toEqual(['x', 'y']);
    });

    test('--description takes the next word, and --description=<text> works too', () => {
        expect([
            parseNewWords(['x', '--description', 'Does it']).description,
            parseNewWords(['x', '--description=Does it']).description
        ]).toEqual(['Does it', 'Does it']);
    });

    test('the value of a flag is the next word even when it starts with a dash', () => {
        expect(parseNewWords(['x', '--description', '-not a flag']).description).toBe(
            '-not a flag'
        );
    });

    test('--arg and --flag repeat, in the order given', () => {
        const read = parseNewWords(['x', '--arg', 'b', '--flag', 'z', '--arg=a', '--flag=y']);

        expect([read.args, read.flags]).toEqual([
            ['b', 'a'],
            ['z', 'y']
        ]);
    });

    test('the flags that stand alone', () => {
        const read = parseNewWords([
            'x',
            '--destructive',
            '--supports-dry-run',
            '--json',
            '--quiet'
        ]);

        expect([read.destructive, read.supportsDryRun, read.json, read.quiet]).toEqual([
            true,
            true,
            true,
            true
        ]);
    });

    test('after -- every word is a command word, a dash too', () => {
        expect(parseNewWords(['x', '--', '-y', '--json']).words).toEqual(['x', '-y', '--json']);
    });

    test('-h and --help ask for the help', () => {
        expect([parseNewWords(['-h']).help, parseNewWords(['--help']).help]).toEqual([true, true]);
    });

    test('--help wins over a problem found before it', () => {
        expect(parseNewWords(['--bogus', '--help']).help).toBe(true);
    });
});

describe('parseNewWords: what is a usage error', () => {
    test.each(['--yes', '-y', '--dry-run', '--log', '--bogus', '-x'])(
        '%s is an unknown option',
        (flag) => {
            expect(thrownBy(() => parseNewWords(['x', flag]))).toMatchObject({
                message: `Unknown option "${flag}"`
            });
        }
    );

    test('a flag with no value because it is last', () => {
        expect(thrownBy(() => parseNewWords(['x', '--description']))).toBeInstanceOf(UsageError);
    });

    test('a flag with an empty inline value', () => {
        expect(thrownBy(() => parseNewWords(['x', '--arg=']))).toMatchObject({
            message: '--arg needs a value'
        });
    });

    test('--description twice', () => {
        expect(
            thrownBy(() => parseNewWords(['x', '--description', 'a', '--description=b']))
        ).toMatchObject({ message: '--description was given twice' });
    });

    test('every one carries the usage line of the word', () => {
        expect(thrownBy(() => parseNewWords(['--bogus']))).toMatchObject({ usage: NEW_USAGE_LINE });
    });
});

const valid = {
    words: ['db', 'reset'],
    description: 'Delete the database',
    args: [],
    flags: [],
    destructive: false,
    supportsDryRun: false,
    json: false,
    quiet: false,
    help: false
};

describe('checkNew: the command words', () => {
    test('a valid line becomes the spec to write from', () => {
        expect(checkNew(valid)).toEqual({
            words: ['db', 'reset'],
            description: 'Delete the database',
            args: [],
            flags: [],
            destructive: false,
            supportsDryRun: false
        });
    });

    test('no words is a usage error', () => {
        expect(thrownBy(() => checkNew({ ...valid, words: [] }))).toMatchObject({
            message: 'new needs the words of the command'
        });
    });

    test.each(['Db', 'db_reset', '-db', 'db.reset', 'é'])('%s is not a valid word', (word) => {
        expect(thrownBy(() => checkNew({ ...valid, words: [word] }))).toMatchObject({
            message: `"${word}" is not a valid command word`
        });
    });

    test.each(['help', ...WORD_NAMES])(
        'the first word may not be %s: the binary would hide the command',
        (word) => {
            expect(thrownBy(() => checkNew({ ...valid, words: [word, 'x'] }))).toMatchObject({
                hint: expect.stringContaining('would be hidden')
            });
        }
    );

    test('a word of the binary is fine after the first', () => {
        expect(checkNew({ ...valid, words: ['db', 'state'] }).words).toEqual(['db', 'state']);
    });
});

describe('checkNew: the description', () => {
    test.each([
        { name: 'missing', description: undefined },
        { name: 'empty', description: '' },
        { name: 'only spaces', description: '   ' }
    ])('$name is a usage error', ({ description }) => {
        expect(thrownBy(() => checkNew({ ...valid, description }))).toMatchObject({
            message: '--description is required'
        });
    });

    test('a line break is a usage error', () => {
        expect(thrownBy(() => checkNew({ ...valid, description: 'one\ntwo' }))).toMatchObject({
            message: '--description must be one line'
        });
    });
});

describe('checkNew: the names of args and flags', () => {
    test('a name that is not lowercase letters, digits and dashes', () => {
        expect(thrownBy(() => checkNew({ ...valid, args: ['Target'] }))).toMatchObject({
            message: '"Target" is not a valid name'
        });
    });

    test('a name may not start with a digit', () => {
        expect(thrownBy(() => checkNew({ ...valid, flags: ['1st'] }))).toMatchObject({
            message: '"1st" is not a valid name'
        });
    });

    test.each(RESERVED_FLAGS)('a flag called %s is a usage error', (name) => {
        expect(thrownBy(() => checkNew({ ...valid, flags: [name] }))).toMatchObject({
            message: `--${name} is a flag every command has already`
        });
    });

    test('a flag named twice', () => {
        expect(thrownBy(() => checkNew({ ...valid, flags: ['keep', 'keep'] }))).toMatchObject({
            message: '"keep" is used twice'
        });
    });

    test('an arg named twice', () => {
        expect(thrownBy(() => checkNew({ ...valid, args: ['a', 'a'] }))).toMatchObject({
            message: '"a" is used twice'
        });
    });

    test('an arg and a flag with one name', () => {
        expect(
            thrownBy(() => checkNew({ ...valid, args: ['keep'], flags: ['keep'] }))
        ).toMatchObject({ message: '"keep" is used twice' });
    });

    test('an arg may be called like a reserved flag: only flags clash', () => {
        expect(checkNew({ ...valid, args: ['json'] }).args).toEqual(['json']);
    });
});

describe('commandFile: where the file goes', () => {
    const dir = path.resolve('work', 'app', 'commands');

    test('one word is a file in the commands folder', () => {
        expect(commandFile(dir, ['hello'])).toBe(path.join(dir, 'hello.js'));
    });

    test('several words are topics, and the last is the file', () => {
        expect(commandFile(dir, ['db', 'seed', 'run'])).toBe(
            path.join(dir, 'db', 'seed', 'run.js')
        );
    });
});

const spec = (overrides: Partial<NewSpec> = {}): NewSpec => ({
    words: ['db', 'reset'],
    description: 'Delete the local database and rebuild it',
    args: [],
    flags: [],
    destructive: false,
    supportsDryRun: false,
    ...overrides
});

const WORK = `        // TODO: the work. ctx.exec runs a program. For a failure the caller can fix, throw new CommandError(message, { hint }) (add CommandError to the import above).`;

describe('renderCommand: the template', () => {
    test('with nothing but a description', () => {
        expect(renderCommand(spec())).toBe(`// @ts-check
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Delete the local database and rebuild it',
    run({ ctx }) {
${WORK}
        return null;
    }
});
`);
    });

    test('with everything: an arg, a flag, destructive and a dry run', () => {
        expect(
            renderCommand(
                spec({ args: ['target'], flags: ['keep'], destructive: true, supportsDryRun: true })
            )
        ).toBe(`// @ts-check
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Delete the local database and rebuild it',
    destructive: true,
    dryRun: true,
    args: [{ name: 'target', required: true, description: 'TODO: describe' }],
    flags: { keep: { type: 'boolean', description: 'TODO: describe' } },
    run({ args, flags, ctx }) {
        ctx.plan('TODO: describe each step this command takes');
        if (ctx.dryRun) {
            return null;
        }

${WORK}
        return { args, flags };
    }
});
`);
    });

    test('run lists only what exists: args alone', () => {
        expect(renderCommand(spec({ args: ['target'] }))).toContain('    run({ args, ctx }) {\n');
    });

    test('run lists only what exists: flags alone, and it returns them alone', () => {
        const source = renderCommand(spec({ flags: ['keep'] }));

        expect([
            source.includes('run({ flags, ctx })'),
            source.includes('return { flags };')
        ]).toEqual([true, true]);
    });

    test('a flag whose name needs quotes is quoted', () => {
        expect(renderCommand(spec({ flags: ['no-prune'] }))).toContain(
            "    flags: { 'no-prune': { type: 'boolean', description: 'TODO: describe' } },\n"
        );
    });

    test('a dry run needs no args or flags', () => {
        expect(renderCommand(spec({ supportsDryRun: true }))).toContain(
            '        return null;\n    }\n});'
        );
    });

    test('a description with an apostrophe is written the way Prettier leaves it', () => {
        expect(renderCommand(spec({ description: "Delete today's data" }))).toContain(
            `    description: "Delete today's data",\n`
        );
    });

    test('a description with a backslash escapes it', () => {
        expect(renderCommand(spec({ description: 'Clean C:\\temp' }))).toContain(
            "    description: 'Clean C:\\\\temp',\n"
        );
    });

    test('a description with both kinds of quote uses single quotes and escapes them', () => {
        expect(renderCommand(spec({ description: `It's "a" test` }))).toContain(
            `    description: 'It\\'s "a" test',\n`
        );
    });
});

/** What Prettier makes of a source under this repository's own settings. */
const prettified = async (source: string): Promise<string> =>
    format(source, {
        ...(await resolveConfig(path.join(import.meta.dirname, 'new.ts'))),
        parser: 'babel'
    });

const LONG =
    'a-very-long-name-that-is-made-up-to-push-the-line-past-the-width-of-one-hundred-columns';

describe('renderCommand: Prettier leaves every variant as it is', () => {
    test.each([
        { name: 'the minimum', given: spec() },
        {
            name: 'everything at once',
            given: spec({ args: ['a'], flags: ['b'], destructive: true, supportsDryRun: true })
        },
        { name: 'two args', given: spec({ args: ['source', 'target'] }) },
        { name: 'three flags', given: spec({ flags: ['keep', 'no-prune', 'force-it'] }) },
        { name: 'one arg with a very long name', given: spec({ args: [LONG] }) },
        {
            name: 'two args, one of them very long',
            given: spec({ args: ['short', LONG] })
        },
        { name: 'one flag with a very long name', given: spec({ flags: [LONG] }) },
        { name: 'two flags, one of them very long', given: spec({ flags: ['a', LONG] }) },
        {
            name: 'flags that together do not fit on a line',
            given: spec({ flags: ['alpha-option', 'beta-option', 'gamma-option', 'delta-option'] })
        },
        { name: 'a very long description', given: spec({ description: `Does ${LONG} ${LONG}` }) },
        { name: 'a description with an apostrophe', given: spec({ description: "Today's data" }) },
        { name: 'a description with both quotes', given: spec({ description: `It's "a" test` }) },
        { name: 'a description with a backslash', given: spec({ description: 'C:\\temp\\x' }) },
        { name: 'a description of only double quotes', given: spec({ description: '"a" "b"' }) }
    ])('$name', async ({ given }) => {
        const source = renderCommand(given);

        expect(await prettified(source)).toBe(source);
    });
});
