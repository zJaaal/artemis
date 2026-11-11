import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { makeRepo } from '../../test/git.js';
import { createTempFolders } from '../../test/temp.js';
import { gitRoot } from './git.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

describe('gitRoot', () => {
    test('is the root of the repo for the root itself', () => {
        const repo = makeRepo(path.join(folders.make('artemis-git-'), 'repo'));

        expect(gitRoot(repo.root)).toBe(repo.root);
    });

    test('is the root of the repo for a folder inside it', () => {
        const repo = makeRepo(path.join(folders.make('artemis-git-'), 'repo'));
        const inside = path.join(repo.root, 'deep', 'er');

        fs.mkdirSync(inside, { recursive: true });

        expect(gitRoot(inside)).toBe(repo.root);
    });

    test('is null outside any repo', () => {
        expect(gitRoot(folders.make('artemis-git-'))).toBeNull();
    });
});
