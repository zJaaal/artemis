import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createTempFolders } from '../test/temp.js';
import { shadowKind, shadowsWord } from './shadow.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

describe('shadowsWord', () => {
    test('a command file called like the word shadows it', () => {
        const commandsDir = folders.make('artemis-shadow-');

        fs.writeFileSync(path.join(commandsDir, 'state.js'), '');

        expect(shadowsWord(commandsDir, 'state')).toBe(true);
    });

    test('a topic folder called like the word shadows it', () => {
        const commandsDir = folders.make('artemis-shadow-');

        fs.mkdirSync(path.join(commandsDir, 'state'));

        expect(shadowsWord(commandsDir, 'state')).toBe(true);
    });

    test('commands with other names do not', () => {
        const commandsDir = folders.make('artemis-shadow-');

        fs.writeFileSync(path.join(commandsDir, 'statement.js'), '');
        fs.writeFileSync(path.join(commandsDir, 'init.js'), '');

        expect(shadowsWord(commandsDir, 'state')).toBe(false);
    });

    test('an empty folder shadows nothing', () => {
        expect(shadowsWord(folders.make('artemis-shadow-'), 'init')).toBe(false);
    });

    test('a folder that does not exist shadows nothing', () => {
        const commandsDir = path.join(folders.make('artemis-shadow-'), 'missing');

        expect(shadowsWord(commandsDir, 'init')).toBe(false);
    });
});

describe('shadowKind', () => {
    test('a command file is a file', () => {
        const commandsDir = folders.make('artemis-shadow-');

        fs.writeFileSync(path.join(commandsDir, 'init.js'), '');

        expect(shadowKind(commandsDir, 'init')).toBe('file');
    });

    test('a topic folder is a folder', () => {
        const commandsDir = folders.make('artemis-shadow-');

        fs.mkdirSync(path.join(commandsDir, 'init'));

        expect(shadowKind(commandsDir, 'init')).toBe('folder');
    });

    test('is undefined when nothing hides the word', () => {
        expect(shadowKind(folders.make('artemis-shadow-'), 'init')).toBeUndefined();
    });
});
