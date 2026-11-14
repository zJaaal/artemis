import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
    ATOMIC_RENAME_RETRIES,
    ATOMIC_RENAME_RETRY_MS,
    FOLDER_PROBLEM,
    WINDOWS_PLATFORM
} from '../constants.js';

import { NO_EXECUTE_MODE, ROOT_UID, UNREADABLE_MODE } from '../test/constants.js';
import { withMode } from '../test/permissions.js';
import { createTempFolders } from '../test/temp.js';
import { thrownBy } from '../test/thrown.js';
import {
    createExclusive,
    folderProblem,
    isFolder,
    listDirectory,
    makeDirectory,
    modifiedAt,
    pathExists,
    readManifest,
    readTextIfExists,
    realPathOrResolve,
    removeFile,
    listJsonFiles,
    renameWithRetry,
    writeAtomic,
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
    const manifestIn = (text: string) => {
        const dir = folders.make('artemis-files-');

        writeText(path.join(dir, 'package.json'), text);

        return { dir, file: path.join(dir, 'package.json') };
    };

    test('reads the package.json of a folder as an object', () => {
        expect(readManifest(manifestIn('{ "name": "app" }').dir)).toEqual({
            manifest: { name: 'app' },
            text: '{ "name": "app" }'
        });
    });

    test('is undefined for a folder with no package.json', () => {
        expect(readManifest(folders.make('artemis-files-'))).toBeUndefined();
    });

    test('a package.json that is not valid JSON is returned as an error naming the file', () => {
        const { dir, file } = manifestIn('{ nope');

        expect(readManifest(dir)).toMatchObject({
            error: { message: expect.stringContaining(`${file} is not valid JSON`) }
        });
    });

    test('a template that is not valid JSON is returned as an error, not thrown', () => {
        const { dir } = manifestIn('{ "name": "{{name}}", }');

        expect(readManifest(dir)).toMatchObject({
            error: { message: expect.stringContaining('is not valid JSON') }
        });
    });

    test('a template whose placeholder is inside a string is valid JSON, so it is read as an object', () => {
        const { dir } = manifestIn('{ "name": "{{name}}" }');

        expect(readManifest(dir)).toEqual({
            manifest: { name: '{{name}}' },
            text: '{ "name": "{{name}}" }'
        });
    });

    test('a package.json that is not an object is returned as an error with a hint', () => {
        expect(readManifest(manifestIn('["app"]').dir)).toMatchObject({
            error: {
                message: expect.stringContaining('must contain a JSON object'),
                hint: expect.stringContaining('"name"')
            }
        });
    });

    test('a package.json that cannot be read is returned as an error naming the file', () => {
        const dir = folders.make('artemis-files-');

        fs.mkdirSync(path.join(dir, 'package.json'));

        expect(readManifest(dir)).toMatchObject({
            error: {
                message: expect.stringContaining(`Cannot read ${path.join(dir, 'package.json')}`),
                hint: expect.stringContaining('readable file')
            }
        });
    });
});

describe('isFolder', () => {
    test('is true for a folder', () => {
        expect(isFolder(folders.make('artemis-files-'))).toBe(true);
    });

    test('is false for a file', () => {
        const file = path.join(folders.make('artemis-files-'), 'a.txt');

        writeText(file, 'x');

        expect(isFolder(file)).toBe(false);
    });

    test('is false for a path that does not exist', () => {
        expect(isFolder(path.join(folders.make('artemis-files-'), 'nope'))).toBe(false);
    });
});

/** A rename that fails with a code `busyFor` times, then works; and the pauses it was given. */
const flakyRename = (code: string, busyFor: number, platform: NodeJS.Platform) => {
    const calls: string[] = [];
    const pauses: number[] = [];
    let failures = 0;

    return {
        calls,
        pauses,
        edges: {
            platform,
            sleep: (ms: number) => pauses.push(ms),
            rename: (from: string, to: string) => {
                calls.push(`${from} -> ${to}`);

                if (failures++ < busyFor) {
                    throw Object.assign(new Error(`${code}: busy`), { code });
                }
            }
        }
    };
};

const isWindows = process.platform === WINDOWS_PLATFORM;

/** Opens the file named by the last argument, says so, and lets go well within the time writeAtomic retries for. */
const HOLD_MS = 80;
const HOLD_THE_FILE = `const fs = require('node:fs'); const fd = fs.openSync(process.argv.at(-1), 'r'); process.stdout.write('open'); setTimeout(() => fs.closeSync(fd), ${HOLD_MS})`;

describe('renameWithRetry', () => {
    test.each(['EPERM', 'EACCES', 'EBUSY'])(
        'on Windows a rename that fails with %s is tried again',
        (code) => {
            const { edges, calls } = flakyRename(code, 3, 'win32');

            renameWithRetry('a', 'b', edges);

            expect(calls).toHaveLength(4);
        }
    );

    test('with ATOMIC_RENAME_RETRY_MS between the tries', () => {
        const { edges, pauses } = flakyRename('EPERM', 3, 'win32');

        renameWithRetry('a', 'b', edges);

        expect(pauses).toEqual([
            ATOMIC_RENAME_RETRY_MS,
            ATOMIC_RENAME_RETRY_MS,
            ATOMIC_RENAME_RETRY_MS
        ]);
    });

    test('it gives up after ATOMIC_RENAME_RETRIES retries, and throws the last error', () => {
        const { edges, calls } = flakyRename('EBUSY', Number.POSITIVE_INFINITY, 'win32');

        expect([thrownBy(() => renameWithRetry('a', 'b', edges)), calls.length]).toEqual([
            expect.objectContaining({ code: 'EBUSY' }),
            ATOMIC_RENAME_RETRIES + 1
        ]);
    });

    test('another error is thrown at once', () => {
        const { edges, calls } = flakyRename('ENOENT', 1, 'win32');

        expect([thrownBy(() => renameWithRetry('a', 'b', edges)), calls.length]).toEqual([
            expect.objectContaining({ code: 'ENOENT' }),
            1
        ]);
    });

    test.each(['linux', 'darwin'] as const)('on %s EPERM is not tried again', (platform) => {
        const { edges, calls } = flakyRename('EPERM', 1, platform);

        expect([thrownBy(() => renameWithRetry('a', 'b', edges)), calls.length]).toEqual([
            expect.objectContaining({ code: 'EPERM' }),
            1
        ]);
    });

    test('a rename that works the first time is one call and no pause', () => {
        const { edges, calls, pauses } = flakyRename('EPERM', 0, 'win32');

        renameWithRetry('a', 'b', edges);

        expect([calls.length, pauses]).toEqual([1, []]);
    });
});

describe('writeAtomic', () => {
    test('creates the file with the whole text', () => {
        const file = path.join(folders.make('artemis-files-'), 'doc.json');

        writeAtomic(file, '{"a":1}\n');

        expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}\n');
    });

    test('replaces the content of a file that is already there', () => {
        const file = path.join(folders.make('artemis-files-'), 'doc.json');

        fs.writeFileSync(file, 'old content that is longer than the new one');
        writeAtomic(file, 'new');

        expect(fs.readFileSync(file, 'utf8')).toBe('new');
    });

    test('leaves no temporary file behind', () => {
        const dir = folders.make('artemis-files-');

        writeAtomic(path.join(dir, 'doc.json'), 'text');

        expect(fs.readdirSync(dir)).toEqual(['doc.json']);
    });

    test('is a different file than the one being replaced until the rename: a reader holding the old one still has it whole', () => {
        const file = path.join(folders.make('artemis-files-'), 'doc.json');

        fs.writeFileSync(file, 'old');
        const reader = fs.openSync(file, 'r');

        writeAtomic(file, 'new');

        expect(fs.readFileSync(reader, 'utf8')).toBe('old');
        fs.closeSync(reader);
    });

    test.skipIf(!isWindows)(
        'a reader in another process that lets go within the retries does not fail the write',
        async () => {
            const file = path.join(folders.make('artemis-files-'), 'doc.json');

            fs.writeFileSync(file, 'old');

            const reader = spawn(process.execPath, ['-e', HOLD_THE_FILE, file], {
                stdio: ['ignore', 'pipe', 'inherit']
            });

            await new Promise((resolve) => reader.stdout.once('data', resolve));
            writeAtomic(file, 'new');
            await new Promise((resolve) => reader.once('exit', resolve));

            expect(fs.readFileSync(file, 'utf8')).toBe('new');
        }
    );

    test('a failed write leaves no temporary file and the target untouched', () => {
        const dir = folders.make('artemis-files-');
        const target = path.join(dir, 'doc.json');

        fs.mkdirSync(target);

        expect(thrownBy(() => writeAtomic(target, 'text'))).toBeInstanceOf(Error);
        expect(fs.readdirSync(dir)).toEqual(['doc.json']);
    });

    test('a folder that does not exist is an error, not a silent noop', () => {
        const file = path.join(folders.make('artemis-files-'), 'missing', 'doc.json');

        expect(thrownBy(() => writeAtomic(file, 'text'))).toBeInstanceOf(Error);
    });
});

describe('listJsonFiles', () => {
    test('lists the json files, sorted', () => {
        const dir = folders.make('artemis-files-');

        fs.writeFileSync(path.join(dir, 'steps.json'), '{}');
        fs.writeFileSync(path.join(dir, 'instances.json'), '{}');

        expect(listJsonFiles(dir)).toEqual(['instances.json', 'steps.json']);
    });

    test('skips lock files', () => {
        const dir = folders.make('artemis-files-');

        fs.writeFileSync(path.join(dir, 'steps.json'), '{}');
        fs.writeFileSync(path.join(dir, 'steps.json.lock'), '123 token');
        fs.writeFileSync(path.join(dir, 'build.lock'), '123 token');

        expect(listJsonFiles(dir)).toEqual(['steps.json']);
    });

    test('skips temporary files', () => {
        const dir = folders.make('artemis-files-');

        fs.writeFileSync(path.join(dir, 'steps.json'), '{}');
        fs.writeFileSync(path.join(dir, 'steps.json.123.abc.tmp'), '{}');

        expect(listJsonFiles(dir)).toEqual(['steps.json']);
    });

    test('skips a folder named like a json file', () => {
        const dir = folders.make('artemis-files-');

        fs.mkdirSync(path.join(dir, 'odd.json'));

        expect(listJsonFiles(dir)).toEqual([]);
    });

    test('lists a symbolic link to a json file', () => {
        const dir = folders.make('artemis-files-');
        const elsewhere = path.join(folders.make('artemis-files-target-'), 'real.json');

        fs.writeFileSync(elsewhere, '{}');
        fs.symlinkSync(elsewhere, path.join(dir, 'linked.json'));

        expect(listJsonFiles(dir)).toEqual(['linked.json']);
    });

    test('skips a symbolic link whose target is gone', () => {
        const dir = folders.make('artemis-files-');

        fs.symlinkSync(path.join(dir, 'nowhere.json'), path.join(dir, 'dangling.json'));

        expect(listJsonFiles(dir)).toEqual([]);
    });

    test('skips a symbolic link to a folder', () => {
        const dir = folders.make('artemis-files-');
        const folder = folders.make('artemis-files-target-');

        fs.symlinkSync(folder, path.join(dir, 'folder.json'));

        expect(listJsonFiles(dir)).toEqual([]);
    });

    test('lists a symbolic link that loops back on itself, so its error can be shown', () => {
        const dir = folders.make('artemis-files-');

        fs.symlinkSync('loop.json', path.join(dir, 'loop.json'));

        expect(listJsonFiles(dir)).toEqual(['loop.json']);
    });

    test('a folder that does not exist has no files', () => {
        const dir = path.join(folders.make('artemis-files-'), 'missing');

        expect(listJsonFiles(dir)).toEqual([]);
    });
});

describe('folderProblem', () => {
    const isRoot = process.getuid?.() === ROOT_UID;

    test('a folder this user can enter has no problem', () => {
        expect(folderProblem(folders.make('artemis-files-'))).toBeUndefined();
    });

    test('a folder that is not there is missing', () => {
        expect(folderProblem(path.join(folders.make('artemis-files-'), 'typo'))).toBe(
            FOLDER_PROBLEM.MISSING
        );
    });

    test('a file is not a folder', () => {
        const file = path.join(folders.make('artemis-files-'), 'plain.txt');

        fs.writeFileSync(file, 'x');

        expect(folderProblem(file)).toBe(FOLDER_PROBLEM.NOT_A_FOLDER);
    });

    test('a path under a file is not a folder', () => {
        const file = path.join(folders.make('artemis-files-'), 'plain.txt');

        fs.writeFileSync(file, 'x');

        expect(folderProblem(path.join(file, 'sub'))).toBe(FOLDER_PROBLEM.NOT_A_FOLDER);
    });

    test('a symlink loop is not a permission problem: it has no answer here', () => {
        const root = folders.make('artemis-files-');
        const first = path.join(root, 'a');

        fs.symlinkSync(path.join(root, 'b'), first);
        fs.symlinkSync(first, path.join(root, 'b'));

        expect(folderProblem(first)).toBeUndefined();
    });

    test.skipIf(isRoot)('a folder with no execute bit is no-access', async () => {
        const folder = folders.make('artemis-files-');

        expect(await withMode(folder, NO_EXECUTE_MODE, () => folderProblem(folder))).toBe(
            FOLDER_PROBLEM.NO_ACCESS
        );
    });

    test.skipIf(isRoot)('a folder under one with mode 0 is no-access', async () => {
        const locked = path.join(folders.make('artemis-files-'), 'locked');

        fs.mkdirSync(path.join(locked, 'sub'), { recursive: true });

        expect(
            await withMode(locked, UNREADABLE_MODE, () => folderProblem(path.join(locked, 'sub')))
        ).toBe(FOLDER_PROBLEM.NO_ACCESS);
    });
});
