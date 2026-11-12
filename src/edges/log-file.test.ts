import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { LOG_FILE_HINT, LOG_FLUSH_BYTES, LOG_FLUSH_MS } from '../constants.js';
import { createTempFolders } from '../test/temp.js';
import { openLogFile } from './log-file.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

describe('openLogFile', () => {
    test('a relative path is resolved against the folder it is given', () => {
        const cwd = folders.make('artemis-log-');
        const log = openLogFile('a.log', cwd);

        log.close();

        expect(log.path).toBe(path.join(cwd, 'a.log'));
    });

    test('what is written lands in the file, in order', () => {
        const cwd = folders.make('artemis-log-');
        const log = openLogFile('a.log', cwd);

        log.write('one\n');
        log.write('two\n');
        log.close();

        expect(fs.readFileSync(log.path, 'utf8')).toBe('one\ntwo\n');
    });

    test('a file that is already there is truncated', () => {
        const cwd = folders.make('artemis-log-');

        fs.writeFileSync(path.join(cwd, 'a.log'), 'old content that is longer\n');

        openLogFile('a.log', cwd).close();

        expect(fs.readFileSync(path.join(cwd, 'a.log'), 'utf8')).toBe('');
    });

    test('a folder that does not exist is a CommandError that says how to fix it', () => {
        const cwd = folders.make('artemis-log-');

        expect(() => openLogFile(path.join('missing', 'a.log'), cwd)).toThrow(
            expect.objectContaining({ hint: LOG_FILE_HINT })
        );
    });

    test('writing after close does nothing and does not throw', () => {
        const cwd = folders.make('artemis-log-');
        const log = openLogFile('a.log', cwd);

        log.close();

        expect(() => log.write('late\n')).not.toThrow();
    });

    test('closing twice is harmless', () => {
        const cwd = folders.make('artemis-log-');
        const log = openLogFile('a.log', cwd);

        log.close();

        expect(() => log.close()).not.toThrow();
    });
});

describe('openLogFile: batched writes', () => {
    test('a line waiting is written after the flush delay, without a close', async () => {
        const cwd = folders.make('artemis-log-');
        const log = openLogFile('a.log', cwd);

        log.write('waiting\n');
        await new Promise((resolve) => setTimeout(resolve, LOG_FLUSH_MS * 3));

        expect(fs.readFileSync(path.join(cwd, 'a.log'), 'utf8')).toBe('waiting\n');

        log.close();
    });

    test('a big write goes out at once, and every line arrives in order', () => {
        const cwd = folders.make('artemis-log-');
        const log = openLogFile('a.log', cwd);
        const line = `${'x'.repeat(99)}\n`;
        const count = Math.ceil(LOG_FLUSH_BYTES / line.length) + 10;

        Array.from({ length: count }, () => line).forEach((chunk) => log.write(chunk));
        log.close();

        expect(fs.readFileSync(path.join(cwd, 'a.log'), 'utf8')).toBe(line.repeat(count));
    });
});
