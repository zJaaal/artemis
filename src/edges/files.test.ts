import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createTempFolders } from '../test/temp.js';
import { thrownBy } from '../test/thrown.js';
import {
    createExclusive,
    listDirectory,
    makeDirectory,
    modifiedAt,
    pathExists,
    readManifest,
    readTextIfExists,
    realPathOrResolve,
    removeFile,
    writeText
} from './files.js';

const folders = createTempFolders();

const MODIFIED_TOLERANCE_MS = 5000;

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

describe('createExclusive: no staging files', () => {
    test('leaves only the created file in the folder', () => {
        const dir = folders.make('artemis-files-');

        createExclusive(path.join(dir, 'lock'), 'mine');

        expect(fs.readdirSync(dir)).toEqual(['lock']);
    });

    test('leaves nothing behind when the file already existed', () => {
        const dir = folders.make('artemis-files-');

        createExclusive(path.join(dir, 'lock'), 'first');
        createExclusive(path.join(dir, 'lock'), 'second');

        expect(fs.readdirSync(dir)).toEqual(['lock']);
    });
});

describe('modifiedAt', () => {
    test('is when the file was last written', () => {
        const file = path.join(folders.make('artemis-files-'), 'a.txt');

        writeText(file, 'x');

        expect(Math.abs((modifiedAt(file) ?? 0) - Date.now())).toBeLessThan(MODIFIED_TOLERANCE_MS);
    });

    test('is undefined for a file that is not there', () => {
        expect(modifiedAt(path.join(folders.make('artemis-files-'), 'gone'))).toBeUndefined();
    });
});

describe('readManifest', () => {
    test('reads the package.json of a folder as an object', () => {
        const dir = folders.make('artemis-files-');

        writeText(path.join(dir, 'package.json'), '{ "name": "app" }');

        expect(readManifest(dir)).toEqual({ name: 'app' });
    });

    test('is undefined for a folder with no package.json', () => {
        expect(readManifest(folders.make('artemis-files-'))).toBeUndefined();
    });

    test('a package.json that is not valid JSON is an error naming the file', () => {
        const dir = folders.make('artemis-files-');

        writeText(path.join(dir, 'package.json'), '{ nope');

        expect(thrownBy(() => readManifest(dir))).toMatchObject({
            message: expect.stringContaining(`${path.join(dir, 'package.json')} is not valid JSON`)
        });
    });

    test('a package.json that is not an object is an error with a hint', () => {
        const dir = folders.make('artemis-files-');

        writeText(path.join(dir, 'package.json'), '["app"]');

        expect(thrownBy(() => readManifest(dir))).toMatchObject({
            message: expect.stringContaining('must contain a JSON object'),
            hint: expect.stringContaining('"name"')
        });
    });
});
