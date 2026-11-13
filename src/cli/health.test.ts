import { describe, expect, test } from 'vitest';

import {
    HEALTH_FAILING_RUNS,
    HEALTH_PREVIEW_RUNS,
    HEALTH_STALE_DAYS,
    MS_PER_DAY
} from '../constants.js';
import type { AuditLine, DoctorCheck, HealthFacts } from '../models.js';
import { healthChecks } from './health.js';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const RECENT = '2026-11-12T12:00:00.000Z';

const line = (overrides: Partial<AuditLine>): AuditLine => ({
    time: RECENT,
    command: 'build',
    argv: [],
    ran: true,
    dryRun: false,
    yes: false,
    exitCode: 0,
    ms: 10,
    ...overrides
});

const times = (count: number, overrides: Partial<AuditLine>): AuditLine[] =>
    Array.from({ length: count }, () => line(overrides));

const LOADED = [
    { id: 'build', destructive: false },
    { id: 'db reset', destructive: true }
];

const checksOf = (entries: AuditLine[], overrides: Partial<HealthFacts> = {}): DoctorCheck[] =>
    healthChecks({ history: { present: true, entries }, loaded: LOADED, now: NOW, ...overrides });

const ids = (checks: DoctorCheck[]): string[] => checks.map((check) => check.id);

describe('healthChecks: no history', () => {
    test('no audit file is one ok check, "no history yet"', () => {
        expect(
            healthChecks({ history: { present: false, entries: [] }, loaded: LOADED, now: NOW })
        ).toEqual([{ id: 'history', status: 'ok', message: 'no history yet' }]);
    });

    test('an empty file says the same', () => {
        expect(checksOf([])).toEqual([{ id: 'history', status: 'ok', message: 'no history yet' }]);
    });

    test('a file that cannot be read is a warning with a fix, never a failure', () => {
        const [check] = healthChecks({
            history: { present: true, entries: [], problem: 'Cannot read the audit trail: EACCES' },
            loaded: LOADED,
            now: NOW
        });

        expect([check?.status, check?.fix]).toEqual([
            'warn',
            expect.stringContaining('permissions')
        ]);
    });
});

describe('healthChecks: nothing wrong', () => {
    test('says how many runs it looked at', () => {
        expect(checksOf(times(4, {}))).toEqual([
            { id: 'history', status: 'ok', message: 'no problems in the last 4 runs' }
        ]);
    });
});

describe('healthChecks: failing', () => {
    test('a command whose last 3 real runs all failed is reported, naming it', () => {
        const [check] = checksOf(times(HEALTH_FAILING_RUNS, { exitCode: 1 }));

        expect(check).toMatchObject({
            id: 'history-failing',
            status: 'warn',
            message: expect.stringContaining('build'),
            fix: 'Run art history build to see the errors.'
        });
    });

    test('one success among the last 3 clears it', () => {
        const entries = [line({ exitCode: 1 }), line({ exitCode: 0 }), line({ exitCode: 1 })];

        expect(ids(checksOf(entries))).toEqual(['history']);
    });

    test('an old success followed by 3 failures is reported', () => {
        const entries = [line({ exitCode: 0 }), ...times(HEALTH_FAILING_RUNS, { exitCode: 1 })];

        expect(ids(checksOf(entries))).toEqual(['history-failing']);
    });

    test('fewer than 3 real runs is not enough', () => {
        expect(ids(checksOf(times(HEALTH_FAILING_RUNS - 1, { exitCode: 1 })))).toEqual(['history']);
    });

    test('a usage error (ran false) never counts as a failure', () => {
        expect(ids(checksOf(times(5, { ran: false, exitCode: 2 })))).toEqual(['history']);
    });

    test('a dry run is not a real run, so it does not break a streak either', () => {
        const entries = [
            line({ exitCode: 1 }),
            line({ exitCode: 1, dryRun: true }),
            line({ exitCode: 0, dryRun: true }),
            line({ exitCode: 1 }),
            line({ exitCode: 1 })
        ];

        expect(ids(checksOf(entries))).toEqual(['history-failing']);
    });

    test('several commands are one check naming each, with a fix for each', () => {
        const entries = [
            ...times(3, { exitCode: 1 }),
            ...times(3, { command: 'db reset', exitCode: 1 })
        ];

        expect(checksOf(entries)).toEqual([
            expect.objectContaining({
                id: 'history-failing',
                message: expect.stringMatching(/build.*db reset/),
                fix: 'Run art history build to see the errors. Run art history db reset to see the errors.'
            })
        ]);
    });
});

describe('healthChecks: only previewed', () => {
    const dry = (count: number, overrides: Partial<AuditLine> = {}) =>
        times(count, { command: 'db reset', dryRun: true, ...overrides });

    test('a destructive command with 3 dry runs and no real run is reported', () => {
        expect(checksOf(dry(HEALTH_PREVIEW_RUNS))[0]).toMatchObject({
            id: 'history-previewed',
            status: 'warn',
            message: expect.stringContaining('db reset'),
            fix: expect.stringMatching(/^db reset: Run it with --yes/)
        });
    });

    test('2 dry runs are not enough', () => {
        expect(ids(checksOf(dry(HEALTH_PREVIEW_RUNS - 1)))).toEqual(['history']);
    });

    test('one real run clears it', () => {
        const entries = [...dry(HEALTH_PREVIEW_RUNS), line({ command: 'db reset' })];

        expect(ids(checksOf(entries))).toEqual(['history']);
    });

    test('a command that is not destructive is not reported', () => {
        expect(ids(checksOf(times(5, { command: 'build', dryRun: true })))).toEqual(['history']);
    });

    test('a dry run that did not run (a usage error) is not a preview', () => {
        expect(ids(checksOf(dry(5, { ran: false, exitCode: 2 })))).toEqual(['history']);
    });
});

describe('healthChecks: stale', () => {
    const daysAgo = (days: number): string => new Date(NOW - days * MS_PER_DAY).toISOString();

    test('a command whose newest line is older than 60 days is reported', () => {
        expect(checksOf([line({ time: daysAgo(HEALTH_STALE_DAYS + 1) })])[0]).toMatchObject({
            id: 'history-stale',
            status: 'warn',
            message: expect.stringContaining('build'),
            fix: 'build: Delete the file if the command is no longer used.'
        });
    });

    test('exactly 60 days is not stale yet', () => {
        expect(ids(checksOf([line({ time: daysAgo(HEALTH_STALE_DAYS) })]))).toEqual(['history']);
    });

    test('a recent run after an old one is not stale', () => {
        const entries = [line({ time: daysAgo(100) }), line({ time: daysAgo(1) })];

        expect(ids(checksOf(entries))).toEqual(['history']);
    });

    test('an unusable time is never stale', () => {
        expect(ids(checksOf([line({ time: 'yesterday' })]))).toEqual(['history']);
    });
});

describe('healthChecks: a fix that names its command', () => {
    test('each stale command has its own part of the fix, joined with a space', () => {
        const old = new Date(NOW - (HEALTH_STALE_DAYS + 1) * MS_PER_DAY).toISOString();

        const checks = checksOf([line({ time: old }), line({ time: old, command: 'db reset' })]);

        expect(checks[0]?.fix).toBe(
            'build: Delete the file if the command is no longer used. db reset: Delete the file if the command is no longer used.'
        );
    });

    test('each previewed command has its own part of the fix', () => {
        const destructive = [
            { id: 'db reset', destructive: true },
            { id: 'db wipe', destructive: true }
        ];

        const entries = [
            ...times(HEALTH_PREVIEW_RUNS, { command: 'db reset', dryRun: true }),
            ...times(HEALTH_PREVIEW_RUNS, { command: 'db wipe', dryRun: true })
        ];

        expect(checksOf(entries, { loaded: destructive })[0]?.fix).toMatch(
            /^db reset: .*\. db wipe: /
        );
    });
});

describe('healthChecks: many lines of one command', () => {
    test('are one command, however many lines there are', () => {
        expect(checksOf(times(1000, {}))).toEqual([
            { id: 'history', status: 'ok', message: 'no problems in the last 1000 runs' }
        ]);
    });
});

describe('healthChecks: commands that are gone', () => {
    test('a command that no longer exists produces nothing', () => {
        const entries = times(5, { command: 'removed', exitCode: 1 });

        expect(ids(checksOf(entries))).toEqual(['history']);
    });

    test('a gone command is not counted in the runs looked at', () => {
        const entries = [...times(2, {}), ...times(5, { command: 'removed' })];

        expect(checksOf(entries)[0]?.message).toBe('no problems in the last 2 runs');
    });

    test('when the commands could not be listed nothing is ignored as gone', () => {
        const entries = times(HEALTH_FAILING_RUNS, { command: 'removed', exitCode: 1 });

        expect(ids(checksOf(entries, { loaded: undefined }))).toEqual(['history-failing']);
    });
});
