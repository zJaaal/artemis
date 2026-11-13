import { describe, expect, test } from 'vitest';

import type { AuditDraft } from '../models.js';
import { buildAuditLine, parseAuditText, stripGlobalFlags } from './audit.js';

const START = Date.parse('2026-11-13T10:02:11.391Z');

const draft = (overrides: Partial<AuditDraft> = {}): AuditDraft => ({
    recordable: true,
    tokens: [],
    ran: true,
    ...overrides
});

const lineOf = (draftOverrides: Partial<AuditDraft> = {}, error?: string, plan: string[] = []) =>
    buildAuditLine({
        commandId: 'db reset',
        draft: draft(draftOverrides),
        startedAt: START,
        endedAt: START + 1840,
        exitCode: 0,
        plan,
        error
    });

describe('stripGlobalFlags', () => {
    test.each([
        ['--json', ['a', '--json']],
        ['--yes', ['--yes', 'a']],
        ['-y', ['a', '-y']],
        ['--dry-run', ['a', '--dry-run']],
        ['--quiet', ['--quiet', 'a']],
        ['--help', ['a', '--help']],
        ['-h', ['a', '-h']]
    ])('removes %s', (_flag, tokens) => {
        expect(stripGlobalFlags(tokens)).toEqual(['a']);
    });

    test('removes the global letters of a group of short flags and keeps the rest (-fy is -f)', () => {
        expect(stripGlobalFlags(['-fy'])).toEqual(['-f']);
    });

    test('removes a group made only of global letters (-yh)', () => {
        expect(stripGlobalFlags(['a', '-yh'])).toEqual(['a']);
    });

    test('keeps a group with no global letter (-fo)', () => {
        expect(stripGlobalFlags(['-fo'])).toEqual(['-fo']);
    });

    test('removes --log and its value', () => {
        expect(stripGlobalFlags(['a', '--log', 'x.log', 'b'])).toEqual(['a', 'b']);
    });

    test('removes --log=<file>', () => {
        expect(stripGlobalFlags(['a', '--log=x.log'])).toEqual(['a']);
    });

    test('keeps flags of the command', () => {
        expect(stripGlobalFlags(['--older-than', '30', '--all'])).toEqual([
            '--older-than',
            '30',
            '--all'
        ]);
    });

    test('keeps -- and everything after it, even a global-looking word', () => {
        expect(stripGlobalFlags(['a', '--json', '--', '--json', '-y'])).toEqual([
            'a',
            '--',
            '--json',
            '-y'
        ]);
    });
});

describe('buildAuditLine', () => {
    test('has the time of the start as an ISO string', () => {
        expect(lineOf().time).toBe('2026-11-13T10:02:11.391Z');
    });

    test('has the command id, ran and the duration', () => {
        expect(lineOf()).toMatchObject({ command: 'db reset', ran: true, ms: 1840, exitCode: 0 });
    });

    test('says dryRun and yes from the words before --', () => {
        expect(lineOf({ tokens: ['--dry-run', '-y'] })).toMatchObject({ dryRun: true, yes: true });
    });

    test('does not read a flag after -- as a flag', () => {
        expect(lineOf({ tokens: ['--', '--dry-run', '--yes'] })).toMatchObject({
            dryRun: false,
            yes: false
        });
    });

    test('has the plan only on a dry run', () => {
        expect(lineOf({ tokens: ['--dry-run'] }, undefined, ['step'])).toHaveProperty('plan', [
            'step'
        ]);

        expect(lineOf({ tokens: [] }, undefined, ['step'])).not.toHaveProperty('plan');
    });

    test('has the error only on a failure', () => {
        expect(lineOf({}, 'it failed')).toHaveProperty('error', 'it failed');
        expect(lineOf()).not.toHaveProperty('error');
    });

    test('keeps the keys in order', () => {
        expect(Object.keys(lineOf({ tokens: ['--dry-run'] }, 'e', []))).toEqual([
            'time',
            'command',
            'argv',
            'ran',
            'dryRun',
            'yes',
            'exitCode',
            'ms',
            'plan',
            'error'
        ]);
    });
});

describe('parseAuditText', () => {
    const good = JSON.stringify({ time: 't', command: 'a', ran: true, exitCode: 0 });

    test('reads one line per entry, in file order', () => {
        const { entries } = parseAuditText(`${good}\n${good.replace('"a"', '"b"')}\n`);

        expect(entries.map((entry) => entry.command)).toEqual(['a', 'b']);
    });

    test('skips and counts a line that is not JSON', () => {
        expect(parseAuditText(`${good}\nnot json\n`)).toMatchObject({ skipped: 1 });
    });

    test('skips and counts JSON that is not an audit line', () => {
        expect(parseAuditText('{"time":1}\n[1]\n"x"\n').skipped).toBe(3);
    });

    test('ignores blank lines without counting them', () => {
        expect(parseAuditText(`\n${good}\n\n`)).toMatchObject({ skipped: 0 });
    });

    test('an empty text has nothing', () => {
        expect(parseAuditText('')).toEqual({ entries: [], skipped: 0 });
    });
});
