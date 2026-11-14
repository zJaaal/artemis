import { describe, expect, test } from 'vitest';

import { BUILTINS } from '../cli/constants.js';
import { EXIT_CODE, SEARCH_MAX_MATCHES } from '../constants.js';
import type { SearchResult } from '../models.js';
import { art, envelope } from '../test/art.js';

const searchOf = async (...argv: string[]): Promise<SearchResult> =>
    envelope(await art(['help', ...argv, '--json'])).result as SearchResult;

describe('help --search: the result', () => {
    test('is ok with the query as typed and how to read one command in full', async () => {
        const result = envelope(await art(['help', '--search', 'Add two numbers', '--json']));

        expect(result).toMatchObject({
            ok: true,
            command: 'help',
            result: { query: 'Add two numbers', more: 'art help <command> --json' }
        });
    });

    test('the best match comes first, as a brief entry with its usage', async () => {
        const { matches } = await searchOf('--search', 'Add two numbers');

        expect(matches[0]).toMatchObject({ id: 'math add', usage: 'math add <a> <b>' });
    });

    test('a match carries destructive and dryRun like a brief entry', async () => {
        const { matches } = await searchOf('--search', 'delete data instance');

        expect(matches[0]).toMatchObject({ id: 'wipe', destructive: true, dryRun: true });
    });

    test('--search=<words> works', async () => {
        expect((await searchOf('--search=greet')).matches[0]?.id).toBe('hello');
    });

    test('a value starting with a dash is the query', async () => {
        const result = await art(['help', '--search', '-greet', '--json']);

        expect(envelope(result).result).toMatchObject({ query: '-greet' });
    });

    test('no match is ok with an empty list and exit 0', async () => {
        const result = await art(['help', '--search', 'zebra', '--json']);

        expect([result.code, (envelope(result).result as SearchResult).matches]).toEqual([
            EXIT_CODE.OK,
            []
        ]);
    });

    test('never returns more than SEARCH_MAX_MATCHES', async () => {
        expect(
            (await searchOf('--search', 'command runs prints')).matches.length
        ).toBeLessThanOrEqual(SEARCH_MAX_MATCHES);
    });

    test('built-in words are not searched', async () => {
        const result = await art(['help', '--search', 'document state', '--json'], {
            builtins: BUILTINS
        });

        expect((envelope(result).result as SearchResult).matches).toEqual([]);
    });
});

describe('help <topic> --search', () => {
    test('searches inside the topic only', async () => {
        const { matches } = await searchOf('math', '--search', 'color');

        expect(matches.map((match) => match.id)).toEqual(['math pick']);
    });

    test('a command outside the topic is not found', async () => {
        expect((await searchOf('math', '--search', 'greet')).matches).toEqual([]);
    });

    test('a command as the scope is a usage error', async () => {
        expect((await art(['help', 'hello', '--search', 'greet'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('a built-in word as the scope is a usage error', async () => {
        const result = await art(['help', 'state', '--search', 'x'], { builtins: BUILTINS });

        expect(result.code).toBe(EXIT_CODE.USAGE);
    });

    test('an unknown scope is an unknown command', async () => {
        expect((await art(['help', 'nope', '--search', 'greet'])).err).toMatch(/Unknown command/);
    });
});

describe('help --search: what it refuses', () => {
    test('a missing value is a usage error', async () => {
        expect((await art(['help', '--search'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('--search --json is a missing value, and still prints the one JSON object', async () => {
        const result = await art(['help', '--search', '--json']);

        expect([result.code, envelope(result).ok]).toEqual([EXIT_CODE.USAGE, false]);
    });

    test('--search --dry-run is refused as --dry-run on help is', async () => {
        expect((await art(['help', '--search', '--dry-run'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('a query with no word left is a usage error with an example', async () => {
        const result = await art(['help', '--search', 'a the of', '--json']);

        expect(envelope(result)).toMatchObject({
            ok: false,
            hint: expect.stringContaining('art help --search "reset database" --json')
        });
    });

    test.each(['--brief', '--agents', '--authoring'])(
        '--search with %s is a usage error',
        async (flag) => {
            expect((await art(['help', '--search', 'greet', flag])).code).toBe(EXIT_CODE.USAGE);
        }
    );
});

describe('help --search: the text', () => {
    test('prints the matches as help --brief does, then how to read one', async () => {
        const { out } = await art(['help', '--search', 'greet someone']);

        expect(out).toMatch(/hello\s+Greet someone/);
        expect(out).toContain('One command in full: art help <command> --json');
    });

    test('says so when nothing matches', async () => {
        expect((await art(['help', '--search', 'zebra'])).out).toBe(
            'No command matches. Run art help --brief.\n'
        );
    });
});
