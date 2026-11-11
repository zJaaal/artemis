import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { CommandError } from '../../errors/errors.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import { defineStore } from './store.js';

const folders = createTempFolders();

afterEach(() => {
    vi.restoreAllMocks();
    folders.cleanUp();
});

/** A project with these fields in its package.json and a file two folders deep. */
const makeProject = (manifest: Record<string, unknown>) => {
    const root = folders.make('artemis-project-');
    const deep = path.join(root, 'src', 'deep');

    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', ...manifest }));
    fs.writeFileSync(path.join(deep, 'command.js'), '');

    return { root, file: path.join(deep, 'command.js'), deep };
};

describe('defineStore({ project })', () => {
    test('the default folder is <root>/state', () => {
        const { root, file } = makeProject({ artemis: {} });

        expect(defineStore({ project: pathToFileURL(file).href }).dir).toBe(
            path.join(root, 'state')
        );
    });

    test('"artemis".stateDir sets it, relative to the project root', () => {
        const { root, file } = makeProject({ artemis: { stateDir: 'data' } });

        expect(defineStore({ project: pathToFileURL(file).href }).dir).toBe(
            path.join(root, 'data')
        );
    });

    test('an absolute stateDir is kept as it is', () => {
        const absolute = folders.make('artemis-absolute-');
        const { file } = makeProject({ artemis: { stateDir: absolute } });

        expect(defineStore({ project: pathToFileURL(file).href }).dir).toBe(absolute);
    });

    test('a file in a subfolder finds the same folder as one at the root', () => {
        const { root, file } = makeProject({ artemis: { stateDir: 'data' } });

        const fromRoot = defineStore({ project: pathToFileURL(path.join(root, 'index.js')).href });

        expect(defineStore({ project: pathToFileURL(file).href }).dir).toBe(fromRoot.dir);
    });

    test('a URL object works like its text', () => {
        const { root, file } = makeProject({ artemis: {} });

        expect(defineStore({ project: pathToFileURL(file) }).dir).toBe(path.join(root, 'state'));
    });

    test('a plain path to a file works too', () => {
        const { root, file } = makeProject({ artemis: {} });

        expect(defineStore({ project: file }).dir).toBe(path.join(root, 'state'));
    });

    test('a folder of the project works too', () => {
        const { root, deep } = makeProject({ artemis: {} });

        expect(defineStore({ project: deep }).dir).toBe(path.join(root, 'state'));
    });

    test('the current folder does not matter', () => {
        const { root, file } = makeProject({ artemis: { stateDir: 'data' } });

        vi.spyOn(process, 'cwd').mockReturnValue(folders.make('artemis-elsewhere-'));

        expect(defineStore({ project: pathToFileURL(file).href }).dir).toBe(
            path.join(root, 'data')
        );
    });

    test('a project with a commands folder and no "artemis" key is found, with the default folder', () => {
        const { root, file } = makeProject({});

        fs.mkdirSync(path.join(root, 'commands'));

        expect(defineStore({ project: file }).dir).toBe(path.join(root, 'state'));
    });

    test('no project from there upwards is a CommandError that says what to create', () => {
        const lonely = folders.make('artemis-lonely-');
        const error = thrownBy(() => defineStore({ project: path.join(lonely, 'file.js') }));

        expect(error).toBeInstanceOf(CommandError);
        expect(error).toMatchObject({ message: expect.stringContaining('No project found') });
    });

    test('a bad stateDir names the field and the file', () => {
        const { root, file } = makeProject({ artemis: { stateDir: 5 } });

        expect(thrownBy(() => defineStore({ project: file }))).toMatchObject({
            message: `"artemis".stateDir must be a non-empty string (in ${path.join(root, 'package.json')})`
        });
    });

    test('something that is not a location is a CommandError that says to pass import.meta.url', () => {
        expect(thrownBy(() => defineStore({ project: 'http://example.com/x.js' }))).toMatchObject({
            hint: 'Pass import.meta.url, or a path.'
        });
    });
});
