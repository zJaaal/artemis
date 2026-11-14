import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { AUDIT_MAX_BYTES, AUDIT_ROTATED_FILE_NAME } from '../constants.js';
import { createTempFolders } from '../test/temp.js';
import { appendAuditLine } from './audit-file.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const newFile = (): string =>
    path.join(folders.make('artemis-audit-edge-'), 'state', 'audit.jsonl');

describe('appendAuditLine', () => {
    test('creates the folders and the file with one line', () => {
        const file = newFile();

        appendAuditLine(file, '{"a":1}');

        expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}\n');
    });

    test('appends after the lines that are there', () => {
        const file = newFile();

        appendAuditLine(file, 'one');
        appendAuditLine(file, 'two');

        expect(fs.readFileSync(file, 'utf8')).toBe('one\ntwo\n');
    });

    test('a file past the limit moves to audit.1.jsonl and a new file starts', () => {
        const file = newFile();

        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'x'.repeat(AUDIT_MAX_BYTES + 1));
        appendAuditLine(file, 'fresh');

        expect([
            fs.readFileSync(file, 'utf8'),
            fs.statSync(path.join(path.dirname(file), AUDIT_ROTATED_FILE_NAME)).size
        ]).toEqual(['fresh\n', AUDIT_MAX_BYTES + 1]);
    });

    test('a file exactly at the limit is not rotated', () => {
        const file = newFile();

        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'x'.repeat(AUDIT_MAX_BYTES));
        appendAuditLine(file, 'more');

        expect(fs.existsSync(path.join(path.dirname(file), AUDIT_ROTATED_FILE_NAME))).toBe(false);
    });

    test('a folder where the file should be is an error, not a silent loss', () => {
        const file = newFile();

        fs.mkdirSync(file, { recursive: true });

        expect(() => appendAuditLine(file, 'x')).toThrow();
    });
});
