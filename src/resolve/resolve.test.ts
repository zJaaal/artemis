import { beforeAll, describe, expect, test } from 'vitest';

import { discover } from '../discover/discover.js';
import type { Registry } from '../models.js';
import { resolve, suggest } from './resolve.js';
import { COMMANDS_FIXTURE_DIR } from '../test/constants.js';

let registry: Registry;

beforeAll(async () => {
    registry = await discover(COMMANDS_FIXTURE_DIR);
});

describe('resolve', () => {
    test('words are matched greedily and the rest stays as the command arguments', () => {
        expect(resolve(registry, ['math', 'add', '1', '2'])).toMatchObject({
            kind: 'command',
            entry: { id: 'math add' },
            rest: ['1', '2']
        });
    });

    test('"topic:command" resolves to the same command', () => {
        expect(resolve(registry, ['math:add', '1', '2'])).toMatchObject({
            kind: 'command',
            entry: { id: 'math add' },
            rest: ['1', '2']
        });
    });

    test('a declared alias resolves to its command', () => {
        expect(resolve(registry, ['m:add', '1'])).toMatchObject({
            kind: 'command',
            entry: { id: 'math add' },
            rest: ['1']
        });
    });

    test('flags end the words that name the command', () => {
        expect(resolve(registry, ['hello', '--json'])).toMatchObject({
            kind: 'command',
            entry: { id: 'hello' },
            rest: ['--json']
        });
    });

    test('a topic name alone resolves to the topic', () => {
        expect(resolve(registry, ['math'])).toMatchObject({ kind: 'topic', topic: { id: 'math' } });
    });

    test('"topic help" resolves to the topic', () => {
        expect(resolve(registry, ['math', 'help'])).toMatchObject({
            kind: 'topic',
            topic: { id: 'math' }
        });
    });

    test('a word after a topic that is not one of its commands is unknown', () => {
        expect(resolve(registry, ['math', 'nope'])).toEqual({ kind: 'unknown', name: 'math nope' });
    });

    test('a file starting with an underscore is not a command', () => {
        expect(resolve(registry, ['_helper'])).toEqual({ kind: 'unknown', name: '_helper' });
    });
});

describe('suggest', () => {
    test('the closest name is suggested for a likely typo', () => {
        expect(suggest(registry, 'helo')).toBe('hello');
    });

    test('an alias can be the suggestion', () => {
        expect(suggest(registry, 'm:ad')).toBe('m:add');
    });

    test('nothing is suggested when no name is close', () => {
        expect(suggest(registry, 'completely-different')).toBeUndefined();
    });
});
