import { describe, expect, test } from 'vitest';

import type { AuditLine } from '../models.js';
import { HISTORY_DEFAULT_LIMIT } from './constants.js';
import { historyLine, parseHistoryWords, selectHistory } from './history.js';

const line = (overrides: Partial<AuditLine>): AuditLine => ({
    time: '2026-11-13T10:00:00.000Z',
    command: 'db reset',
    argv: [],
    ran: true,
    dryRun: false,
    yes: false,
    exitCode: 0,
    ms: 10,
    ...overrides
});

describe('parseHistoryWords', () => {
    test('no words asks for every command, the default number of runs', () => {
        expect(parseHistoryWords([])).toEqual({
            command: [],
            limit: HISTORY_DEFAULT_LIMIT,
            json: false,
            help: false,
            quiet: false
        });
    });

    test('every word is part of the command id', () => {
        expect(parseHistoryWords(['db', 'reset']).command).toEqual(['db', 'reset']);
    });

    test('every word after -- is part of the id, even one that looks like a flag', () => {
        expect(parseHistoryWords(['--', '--json']).command).toEqual(['--json']);
    });

    test('--limit takes the next word', () => {
        expect(parseHistoryWords(['--limit', '5']).limit).toBe(5);
    });

    test('--limit=5 works too', () => {
        expect(parseHistoryWords(['--limit=5']).limit).toBe(5);
    });

    test('flags may come before or after the command words', () => {
        expect(parseHistoryWords(['--limit', '3', 'db', '--json', 'reset'])).toMatchObject({
            command: ['db', 'reset'],
            limit: 3,
            json: true
        });
    });

    test.each(['0', '-1', '1.5', 'abc', ''])('--limit %s is a usage error', (value) => {
        expect(() => parseHistoryWords(['--limit', value])).toThrow(/whole number/);
    });

    test('--limit with no value is a usage error', () => {
        expect(() => parseHistoryWords(['--limit'])).toThrow(/whole number/);
    });

    test('--limit followed by a flag has no value', () => {
        expect(() => parseHistoryWords(['--limit', '--json'])).toThrow(/whole number/);
    });

    test.each(['--dry-run', '--log', '--yes', '--bogus'])('%s is a usage error', (flag) => {
        expect(() => parseHistoryWords([flag])).toThrow(/Unknown option/);
    });

    test('-h and --help ask for help, --quiet and --json are read', () => {
        expect(parseHistoryWords(['-h', '--quiet', '--json'])).toMatchObject({
            help: true,
            quiet: true,
            json: true
        });
    });
});

describe('selectHistory', () => {
    const entries = [
        line({ time: 't1', command: 'a' }),
        line({ time: 't2', command: 'b' }),
        line({ time: 't3', command: 'a' })
    ];

    test('the newest first', () => {
        expect(
            selectHistory(entries, { commandId: undefined, limit: 10 }).map((e) => e.time)
        ).toEqual(['t3', 't2', 't1']);
    });

    test('at most the limit', () => {
        expect(
            selectHistory(entries, { commandId: undefined, limit: 2 }).map((e) => e.time)
        ).toEqual(['t3', 't2']);
    });

    test('only the runs of one command', () => {
        expect(selectHistory(entries, { commandId: 'a', limit: 10 }).map((e) => e.time)).toEqual([
            't3',
            't1'
        ]);
    });

    test('does not change the entries it was given', () => {
        selectHistory(entries, { commandId: undefined, limit: 1 });

        expect(entries.map((e) => e.time)).toEqual(['t1', 't2', 't3']);
    });
});

describe('historyLine', () => {
    test('is the time, the command, the exit code and the arguments', () => {
        expect(historyLine(line({ argv: ['--force', 'x'], exitCode: 1 }))).toBe(
            '2026-11-13T10:00:00.000Z  db reset  exit 1  --force x'
        );
    });

    test('says dry run for a dry run', () => {
        expect(historyLine(line({ dryRun: true }))).toBe(
            '2026-11-13T10:00:00.000Z  db reset  dry run'
        );
    });
});
