import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createFakeLockOptions } from '../../test/lock-edges.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import { LOCK_SUFFIX } from './constants.js';
import { resolveLockEdges } from './lock-options.js';
import { inspectDocument, parseDocumentText, removeDocument } from './raw.js';

const folders = createTempFolders();

const HOLDER_PID = 4242;
const DEAD_PID = 999_999;
const TIMEOUT_MS = 100;

afterEach(() => folders.cleanUp());

const documentWith = (text: string) => {
    const file = path.join(folders.make('artemis-raw-'), 'steps.json');

    fs.writeFileSync(file, text);

    return file;
};

describe('parseDocumentText', () => {
    test('valid JSON is parsed', () => {
        expect(parseDocumentText('steps.json', '{"a":1}')).toEqual({ parsed: { a: 1 } });
    });

    test('text that is not JSON names the file and the reason', () => {
        expect(parseDocumentText('data/steps.json', '{ nope')).toEqual({
            error: expect.stringMatching(/^data\/steps\.json is not valid JSON: /)
        });
    });
});

describe('inspectDocument', () => {
    test('a plain file is version 0 and all of its content', () => {
        expect(inspectDocument(documentWith('{"build":true}'))).toEqual({
            version: 0,
            data: { build: true }
        });
    });

    test('a wrapped file gives its version and its data', () => {
        expect(inspectDocument(documentWith('{"$version":2,"data":{"build":true}}'))).toEqual({
            version: 2,
            data: { build: true }
        });
    });

    test('a file newer than any code is still read, as it is', () => {
        expect(inspectDocument(documentWith('{"$version":99,"data":[1]}'))).toEqual({
            version: 99,
            data: [1]
        });
    });

    test('a file that is not JSON is an error, not a throw', () => {
        const file = documentWith('{ nope');

        expect(inspectDocument(file)).toEqual({
            error: expect.stringContaining(`${file} is not valid JSON`)
        });
    });

    test('a file that does not exist is an error naming it', () => {
        const file = path.join(folders.make('artemis-raw-'), 'ghost.json');

        expect(inspectDocument(file)).toEqual({ error: `${file} does not exist.` });
    });

    test('something that cannot be read as a file is an error, not a throw', () => {
        const file = path.join(folders.make('artemis-raw-'), 'folder.json');

        fs.mkdirSync(file);

        expect(inspectDocument(file)).toEqual({
            error: expect.stringContaining(`${file} cannot be read`)
        });
    });

    test('never changes the file', () => {
        const file = documentWith('{"build":true}');

        inspectDocument(file);

        expect(fs.readFileSync(file, 'utf8')).toBe('{"build":true}');
    });
});

describe('inspectDocument: a version that is not a version', () => {
    test('a negative $version is reported as an error, not shown as version -1', () => {
        const file = documentWith('{"$version":-1,"data":{}}');

        expect(inspectDocument(file)).toEqual({ error: expect.stringContaining(file) });
    });

    test('a fractional $version is reported as an error', () => {
        expect(inspectDocument(documentWith('{"$version":0.5,"data":{}}'))).toEqual({
            error: expect.stringContaining('whole number')
        });
    });
});

describe('removeDocument', () => {
    test('deletes the file', () => {
        const file = documentWith('{}');

        removeDocument(file, resolveLockEdges());

        expect(fs.existsSync(file)).toBe(false);
    });

    test('a file that is not there is not an error', () => {
        const file = path.join(folders.make('artemis-raw-'), 'ghost.json');

        expect(thrownBy(() => removeDocument(file, resolveLockEdges()))).toBeUndefined();
    });

    test('deletes a file that is not valid JSON, without reading it', () => {
        const file = documentWith('{ nope');

        removeDocument(file, resolveLockEdges());

        expect(fs.existsSync(file)).toBe(false);
    });

    test('leaves no lock behind', () => {
        const file = documentWith('{}');

        removeDocument(file, resolveLockEdges());

        expect(fs.readdirSync(path.dirname(file))).toEqual([]);
    });

    test('waits while another live process holds the document lock, then deletes', () => {
        const file = documentWith('{}');
        const lock = `${file}${LOCK_SUFFIX}`;

        const { options, pauses } = createFakeLockOptions({
            isProcessAlive: (pid) => pid === HOLDER_PID,
            timeoutMs: TIMEOUT_MS,
            onPause: () => fs.rmSync(lock, { force: true })
        });

        fs.writeFileSync(lock, `${HOLDER_PID} theirs`);
        removeDocument(file, resolveLockEdges(options));

        expect([pauses.length > 0, fs.existsSync(file)]).toEqual([true, false]);
    });

    test('keeps the file when the lock cannot be taken in time', () => {
        const file = documentWith('{}');

        const { options } = createFakeLockOptions({
            isProcessAlive: (pid) => pid === HOLDER_PID,
            timeoutMs: TIMEOUT_MS
        });

        fs.writeFileSync(`${file}${LOCK_SUFFIX}`, `${HOLDER_PID} theirs`);
        thrownBy(() => removeDocument(file, resolveLockEdges(options)));

        expect(fs.existsSync(file)).toBe(true);
    });

    test('takes over a lock left by a process that died', () => {
        const file = documentWith('{}');

        const { options } = createFakeLockOptions({
            isProcessAlive: (pid) => pid === HOLDER_PID,
            timeoutMs: TIMEOUT_MS
        });

        fs.writeFileSync(`${file}${LOCK_SUFFIX}`, `${DEAD_PID} gone`);
        removeDocument(file, resolveLockEdges(options));

        expect(fs.existsSync(file)).toBe(false);
    });
});
