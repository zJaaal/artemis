import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { MANIFEST_FILE } from '../constants.js';
import { createTempFolders } from '../test/temp.js';
import { thrownBy } from '../test/thrown.js';
import { projectOrThrow } from './project.js';

describe('projectOrThrow', () => {
    const folders = createTempFolders();

    afterEach(() => folders.cleanUp());

    test('is the project of the folder, found on the disk', () => {
        const root = folders.make('artemis-project-');

        fs.writeFileSync(
            path.join(root, MANIFEST_FILE),
            JSON.stringify({ name: 'app', artemis: {} })
        );

        expect(projectOrThrow(root, 'shipped').root).toBe(root);
    });

    test('is found from a folder inside it', () => {
        const root = folders.make('artemis-project-');
        const inside = path.join(root, 'src', 'deep');

        fs.writeFileSync(
            path.join(root, MANIFEST_FILE),
            JSON.stringify({ name: 'app', artemis: {} })
        );

        fs.mkdirSync(inside, { recursive: true });

        expect(projectOrThrow(inside, 'shipped').root).toBe(root);
    });

    test('where there is none it throws the no-project error of the shipped route, with its hint', () => {
        const nowhere = folders.make('artemis-nowhere-');

        expect(thrownBy(() => projectOrThrow(nowhere, 'shipped'))).toMatchObject({
            message: expect.stringContaining('No project found from'),
            hint: expect.stringContaining('init')
        });
    });

    test('and the one of the own route, which asks the author for a bin', () => {
        const nowhere = folders.make('artemis-nowhere-');

        expect(thrownBy(() => projectOrThrow(nowhere, 'own'))).toMatchObject({
            message: expect.stringContaining('with a "bin" field')
        });
    });
});
