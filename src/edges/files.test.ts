import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createTempFolders } from '../test/temp.js';
import { thrownBy } from '../test/thrown.js';
import {
    createExclusive,
    listDirectory,
    makeDirectory,
    pathExists,
    readTextIfExists,
    realPathOrResolve,
    removeFile,
    writeText
} from './files.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

describe('listDirectory and pathExists', () => {
    test('lists names, telling folders from files', () => {
        const dir = folders.make('artemis-files-');

        fs.mkdirSync(path.join(dir, 'topic'));
        fs.writeFileSync(path.join(dir, 'hello.js'), '');

        expect(listDirectory(dir).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
            { name: 'hello.js', isDirectory: false },
            { name: 'topic', isDirectory: true }
        ]);
    });

    test('a path that exists is found', () => {
        expect(pathExists(folders.make('artemis-files-'))).toBe(true);
    });

    test('a path that does not exist is not found', () => {
        expect(pathExists(path.join(folders.make('artemis-files-'), 'nope'))).toBe(false);
    });
});

describe('makeDirectory, writeText and removeFile', () => {
    test('makeDirectory creates nested folders', () => {
        const target = path.join(folders.make('artemis-files-'), 'a', 'b');

        makeDirectory(target);

        expect(fs.statSync(target).isDirectory()).toBe(true);
    });

    test('makeDirectory is fine with a folder that exists', () => {
        expect(() => makeDirectory(folders.make('artemis-files-'))).not.toThrow();
    });

    test('writeText replaces what a file held', () => {
        const file = path.join(folders.make('artemis-files-'), 'a.txt');

        writeText(file, 'one');
        writeText(file, 'two');

        expect(fs.readFileSync(file, 'utf8')).toBe('two');
    });

    test('removeFile removes a file', () => {
        const file = path.join(folders.make('artemis-files-'), 'a.txt');

        writeText(file, 'x');
        removeFile(file);

        expect(fs.existsSync(file)).toBe(false);
    });

    test('removeFile is fine with a file that is already gone', () => {
        expect(() => removeFile(path.join(folders.make('artemis-files-'), 'gone'))).not.toThrow();
    });
});

describe('readTextIfExists', () => {
    test('reads the text of a file', () => {
        const file = path.join(folders.make('artemis-files-'), 'a.txt');

        writeText(file, 'hello');

        expect(readTextIfExists(file)).toBe('hello');
    });

    test('is undefined for a file that is not there', () => {
        expect(readTextIfExists(path.join(folders.make('artemis-files-'), 'gone'))).toBeUndefined();
    });

    test('still fails for any other problem, such as reading a folder', () => {
        expect(thrownBy(() => readTextIfExists(folders.make('artemis-files-')))).toMatchObject({
            code: 'EISDIR'
        });
    });
});

describe('createExclusive', () => {
    test('creates a file that does not exist', () => {
        const file = path.join(folders.make('artemis-files-'), 'lock');

        expect(createExclusive(file, 'mine')).toBe(true);
    });

    test('says no when someone already has the file, and leaves it alone', () => {
        const file = path.join(folders.make('artemis-files-'), 'lock');

        createExclusive(file, 'first');

        expect([createExclusive(file, 'second'), fs.readFileSync(file, 'utf8')]).toEqual([
            false,
            'first'
        ]);
    });
});

describe('realPathOrResolve', () => {
    test('follows a symlink to the real folder', () => {
        const dir = folders.make('artemis-files-');
        const link = path.join(dir, 'link');

        fs.symlinkSync(dir, link);

        expect(realPathOrResolve(link)).toBe(fs.realpathSync(dir));
    });

    test('a folder that does not exist yet is resolved as given', () => {
        expect(realPathOrResolve('relative/missing')).toBe(path.resolve('relative/missing'));
    });
});
