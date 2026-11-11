import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { STATE_INDENT_SPACES } from './constants.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import { createRegistryStore } from './registry-store.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const stateFileIn = (...parts: string[]) => path.join(folders.make('artemis-store-'), ...parts);

describe('the registry store', () => {
    test('a registry that was never written is empty', () => {
        expect(createRegistryStore(stateFileIn('state.json')).read()).toEqual({});
    });

    test('what was written is read back', () => {
        const store = createRegistryStore(stateFileIn('state.json'));
        const records = { feat: { slot: 1, root: '/w/feat' } };

        store.write(records);

        expect(store.read()).toEqual(records);
    });

    test('writes indented JSON with a final newline', () => {
        const stateFile = stateFileIn('state.json');

        createRegistryStore(stateFile).write({ a: { slot: 1, root: null } });

        expect(fs.readFileSync(stateFile, 'utf8')).toBe(
            `${JSON.stringify({ a: { slot: 1, root: null } }, null, STATE_INDENT_SPACES)}\n`
        );
    });

    test('creates the folder of the registry when it is missing', () => {
        const stateFile = stateFileIn('not', 'there', 'state.json');

        createRegistryStore(stateFile).write({});

        expect(fs.existsSync(stateFile)).toBe(true);
    });

    test('a file that is not valid JSON fails with the file name in the message', () => {
        const stateFile = stateFileIn('state.json');

        fs.writeFileSync(stateFile, '{ nope');

        expect(thrownBy(() => createRegistryStore(stateFile).read())).toMatchObject({
            message: expect.stringContaining(`${stateFile} is not valid JSON`)
        });
    });

    test('a file that is not valid JSON fails with a hint to fix or delete it', () => {
        const stateFile = stateFileIn('state.json');

        fs.writeFileSync(stateFile, '{ nope');

        expect(thrownBy(() => createRegistryStore(stateFile).read())).toMatchObject({
            hint: 'Fix the file, or delete it to forget every registered worktree.'
        });
    });
});
