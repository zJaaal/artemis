import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { AUDIT_FILE_NAME } from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type { AuditLine } from '../models.js';
import { createTempFolders } from '../test/temp.js';
import { thrownBy } from '../test/thrown.js';
import { HISTORY_DEFAULT_LIMIT } from './constants.js';
import { readHistory } from './read-history.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const line = (overrides: Partial<AuditLine> = {}): AuditLine => ({
    time: '2026-11-12T12:00:00.000Z',
    command: 'greet',
    argv: [],
    ran: true,
    dryRun: false,
    yes: false,
    exitCode: 0,
    ms: 5,
    ...overrides
});

/** An audit file with these lines, one per line, and any raw text after them. */
const trailWith = (lines: AuditLine[], extra = ''): string => {
    const file = path.join(folders.make('artemis-read-history-'), AUDIT_FILE_NAME);

    fs.writeFileSync(file, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n${extra}`);

    return file;
};

describe('readHistory: what it returns', () => {
    test('the runs of the file, newest first', () => {
        const file = trailWith([line({ ms: 1 }), line({ ms: 2 }), line({ ms: 3 })]);

        expect(readHistory(file).entries.map((entry) => entry.ms)).toEqual([3, 2, 1]);
    });

    test('a line that is not a run is counted as skipped, not thrown', () => {
        const file = trailWith([line()], 'this is not json\n');

        expect(readHistory(file).skipped).toBe(1);
    });

    test('one command id keeps only its runs', () => {
        const file = trailWith([line({ command: 'greet' }), line({ command: 'db reset' })]);

        expect(readHistory(file, { command: 'db reset' }).entries.map((e) => e.command)).toEqual([
            'db reset'
        ]);
    });

    test('an alias is not resolved: it matches no id', () => {
        const file = trailWith([line({ command: 'greet' })]);

        expect(readHistory(file, { command: 'hi' }).entries).toEqual([]);
    });

    test('at most `limit` runs, the newest', () => {
        const file = trailWith([line({ ms: 1 }), line({ ms: 2 }), line({ ms: 3 })]);

        expect(readHistory(file, { limit: 2 }).entries.map((entry) => entry.ms)).toEqual([3, 2]);
    });

    test('the default limit is HISTORY_DEFAULT_LIMIT', () => {
        const file = trailWith(Array.from({ length: HISTORY_DEFAULT_LIMIT + 5 }, () => line()));

        expect(readHistory(file).entries).toHaveLength(HISTORY_DEFAULT_LIMIT);
    });
});

describe('readHistory: a file that is not there or cannot be read', () => {
    test('a missing file has no runs', () => {
        const file = path.join(folders.make('artemis-read-history-'), AUDIT_FILE_NAME);

        expect(readHistory(file)).toEqual({ entries: [], skipped: 0 });
    });

    test('a path that is a folder is the CommandError art history throws, naming the file', () => {
        const folder = folders.make('artemis-read-history-');
        const error = thrownBy(() => readHistory(folder));

        expect(error).toMatchObject({
            message: expect.stringContaining(`Cannot read the audit trail ${folder}`)
        });
    });

    test('and it is a CommandError with a hint', () => {
        const error = thrownBy(() => readHistory(folders.make('artemis-read-history-')));

        expect(error).toBeInstanceOf(CommandError);
    });
});

describe('readHistory: a limit that is not a whole number above 0', () => {
    test.each([
        { name: 'zero', limit: 0 },
        { name: 'a negative number', limit: -1 },
        { name: 'a fraction', limit: 1.5 },
        { name: 'not a number', limit: Number.NaN }
    ])('$name is a TypeError', ({ limit }) => {
        const file = trailWith([line()]);

        expect(thrownBy(() => readHistory(file, { limit }))).toBeInstanceOf(TypeError);
    });
});
