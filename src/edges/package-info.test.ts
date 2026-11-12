import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createTempFolders } from '../test/temp.js';
import { findLocalCopy, readRunningPackage } from './package-info.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const putCopy = (dir: string, version: string): string => {
    const copy = path.join(dir, 'node_modules', '@zjaaal', 'artemis');

    fs.mkdirSync(copy, { recursive: true });
    fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify({ version }));

    return copy;
};

describe('readRunningPackage', () => {
    test('reads the version of this package from its own package.json', () => {
        const own = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

        expect(readRunningPackage().version).toBe(own.version);
    });

    test('says where the package is: the folder that holds its package.json', () => {
        expect(fs.existsSync(path.join(readRunningPackage().root, 'package.json'))).toBe(true);
    });
});

describe('findLocalCopy', () => {
    test('finds the copy in the project own node_modules', () => {
        const root = folders.make('artemis-copy-');
        const copy = putCopy(root, '1.2.3');

        expect(findLocalCopy(root)).toEqual({ version: '1.2.3', root: copy });
    });

    test('finds a copy hoisted to a parent folder, the way Node resolves a package', () => {
        const parent = folders.make('artemis-copy-');
        const copy = putCopy(parent, '1.2.3');
        const child = path.join(parent, 'packages', 'app');

        fs.mkdirSync(child, { recursive: true });

        expect(findLocalCopy(child)?.root).toBe(copy);
    });

    test('prefers the nearest copy', () => {
        const parent = folders.make('artemis-copy-');
        const child = path.join(parent, 'app');

        putCopy(parent, '1.0.0');
        const near = putCopy(child, '2.0.0');

        expect(findLocalCopy(child)?.root).toBe(near);
    });

    test('is undefined when there is no copy', () => {
        expect(findLocalCopy(folders.make('artemis-copy-'))).toBeUndefined();
    });

    test('is undefined for a copy whose package.json has no version', () => {
        const root = folders.make('artemis-copy-');
        const copy = putCopy(root, '1.0.0');

        fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify({ name: 'x' }));

        expect(findLocalCopy(root)).toBeUndefined();
    });
});
