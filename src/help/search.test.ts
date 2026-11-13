import { describe, expect, test } from 'vitest';

import { SEARCH_MAX_MATCHES } from '../constants.js';
import type { ManifestCommand, TopicEntry } from '../models.js';
import { readSearch, searchCommands, wordsOf } from './search.js';

const command = (id: string, description: string, extra: Partial<ManifestCommand> = {}) =>
    ({ id, description, usage: id, args: [], flags: [], ...extra }) satisfies ManifestCommand;

const TOPICS: TopicEntry[] = [
    { id: 'db', description: 'The local database' },
    { id: 'artifacts', description: 'Build outputs' }
];

const COMMANDS: ManifestCommand[] = [
    command('artifacts prune', 'Delete build artifacts older than a number of days'),
    command('artifacts list', 'List the build artifacts'),
    command('db reset', 'Drop every table and start again', { aliases: ['db:wipe'] }),
    command('db seed', 'Load sample rows'),
    command('build', 'Compile the project', { examples: ['build --release'] }),
    command('deploy', 'Ship a build to a server', {
        args: [{ name: 'target', description: 'The server to ship to' }]
    })
];

const idsOf = (query: string, topicId?: string): string[] =>
    searchCommands({ commands: COMMANDS, topics: TOPICS, query, topicId }).map((match) => match.id);

describe('wordsOf', () => {
    test('lowercases and splits on anything that is not a letter or a digit', () => {
        expect(wordsOf('Delete-old_Builds, v2!')).toEqual(['delete', 'old', 'builds', 'v2']);
    });

    test('drops one-character words', () => {
        expect(wordsOf('a b db')).toEqual(['db']);
    });

    test('keeps two-character words such as topic names', () => {
        expect(wordsOf('ci db')).toEqual(['ci', 'db']);
    });

    test('drops stop words', () => {
        expect(wordsOf('reset the database for all')).toEqual(['reset', 'database', 'all']);
    });

    test('drops the words of the stop list, such as the and with', () => {
        expect(wordsOf('the and with from into of to in on an')).toEqual([]);
    });

    test('keeps letters and digits of any script', () => {
        expect(wordsOf('Café 数据库 ñandú')).toEqual(['café', '数据库', 'ñandú']);
    });
});

describe('search: matching words', () => {
    test('an equal word matches', () => {
        expect(idsOf('seed')).toEqual(['db seed']);
    });

    test('a query word of 4 characters or more matches a longer word it is a prefix of', () => {
        expect(idsOf('artifact')).toEqual(['artifacts list', 'artifacts prune']);
    });

    test('a query word longer than a command word of 4 characters or more matches it', () => {
        expect(idsOf('builds')).toContain('build');
    });

    test('a prefix shorter than 4 characters does not match', () => {
        expect(idsOf('art')).toEqual([]);
    });

    test('a short word still matches an equal word', () => {
        expect(idsOf('db')).toEqual(['db reset', 'db seed']);
    });

    test('an alias is searched', () => {
        expect(idsOf('wipe')).toEqual(['db reset']);
    });

    test('an example is searched', () => {
        expect(idsOf('release')).toEqual(['build']);
    });

    test('an arg name and description are searched', () => {
        expect(idsOf('server')).toEqual(['deploy']);
    });

    test('the description of a topic above the command is searched', () => {
        expect(idsOf('database')).toEqual(['db reset', 'db seed']);
    });
});

describe('search: the score', () => {
    test('more distinct query words matching ranks higher', () => {
        expect(idsOf('delete old build artifacts')[0]).toBe('artifacts prune');
    });

    test('the same query word twice counts once', () => {
        expect(idsOf('build build build')).toEqual(idsOf('build'));
    });

    test('a word of the id adds the bonus once, however many query words match the id', () => {
        const matches = searchCommands({
            commands: [
                command('zeta eta', 'Does a thing'),
                command('plain', 'About zeta eta theta')
            ],
            topics: [],
            query: 'zeta eta theta',
            topicId: undefined
        });

        // 2 words + 1 bonus ties the 3 words of the other, so the id decides; a bonus per word would win
        expect(matches.map((match) => match.id)).toEqual(['plain', 'zeta eta']);
    });

    test('ties go by id', () => {
        expect(idsOf('local database')).toEqual(['db reset', 'db seed']);
    });

    test('at most SEARCH_MAX_MATCHES come back, whatever the size of the project', () => {
        const many = Array.from({ length: 40 }, (_, index) => command(`task${index}`, 'Run a job'));

        const matches = searchCommands({
            commands: many,
            topics: [],
            query: 'run job',
            topicId: undefined
        });

        expect(matches).toHaveLength(SEARCH_MAX_MATCHES);
    });

    test('a command scoring 0 is left out', () => {
        expect(idsOf('compile')).toEqual(['build']);
    });

    test('no match is an empty list', () => {
        expect(idsOf('zebra')).toEqual([]);
    });
});

describe('search: inside a topic', () => {
    test('only the commands under the topic are searched', () => {
        expect(idsOf('build', 'artifacts')).toEqual(['artifacts list', 'artifacts prune']);
    });

    test('a command outside the topic is not returned', () => {
        expect(idsOf('compile', 'db')).toEqual([]);
    });
});

describe('readSearch', () => {
    test('is absent when --search was not typed', () => {
        expect(readSearch(['db', '--json'])).toEqual({
            present: false,
            query: undefined,
            words: ['db']
        });
    });

    test('takes the next token as the query', () => {
        expect(readSearch(['--search', 'reset database', '--json'])).toEqual({
            present: true,
            query: 'reset database',
            words: []
        });
    });

    test('takes --search=<words> too', () => {
        expect(readSearch(['--search=reset db']).query).toBe('reset db');
    });

    test('a value starting with a dash is the value', () => {
        expect(readSearch(['--search', '-fast']).query).toBe('-fast');
    });

    test('the value is never a topic word, and a topic word stays one', () => {
        expect(readSearch(['db', '--search', 'reset']).words).toEqual(['db']);
    });

    test.each(['--json', '--quiet', '--dry-run', '--log', '--yes', '--help', '-h', '-y'])(
        'a global flag %s after --search stays that flag, so the search has no value',
        (flag) => {
            expect(readSearch(['--search', flag]).query).toBeUndefined();
        }
    );

    test('a missing value is a search with no query', () => {
        expect(readSearch(['--search'])).toMatchObject({ present: true, query: undefined });
    });

    test('--search after -- is a plain word', () => {
        expect(readSearch(['--', '--search'])).toMatchObject({ present: false });
    });
});
