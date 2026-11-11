import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { DEFAULT_BIN_NAME } from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type { ReadManifestFn } from '../models.js';
import { thrownBy } from '../test/thrown.js';
import { findProject, resolveBinName, resolveSettings } from './settings.js';

/** Manifests by folder: the only "files" the pure code gets to see. */
const manifestsAt =
    (manifests: Record<string, Record<string, unknown>>): ReadManifestFn =>
    (dir) =>
        manifests[dir];

describe('findProject', () => {
    test('is the current folder when it has a package.json', () => {
        const project = findProject('/work/app', manifestsAt({ '/work/app': { name: 'app' } }));

        expect(project).toEqual({ root: '/work/app', manifest: { name: 'app' } });
    });

    test('walks up to a parent folder when the current one has none', () => {
        const project = findProject(
            '/work/app/src/deep',
            manifestsAt({ '/work/app': { name: 'app' } })
        );

        expect(project?.root).toBe('/work/app');
    });

    test('the nearest package.json wins over one in a parent folder', () => {
        const project = findProject(
            '/work/packages/inner/src',
            manifestsAt({ '/work': { name: 'outer' }, '/work/packages/inner': { name: 'inner' } })
        );

        expect(project?.root).toBe('/work/packages/inner');
    });

    test('the nearest one wins even when it has no "artemis" key and a parent has one', () => {
        const project = findProject(
            '/work/packages/inner',
            manifestsAt({
                '/work': { artemis: { commandsDir: 'tools' } },
                '/work/packages/inner': { name: 'inner' }
            })
        );

        expect(project?.manifest).toEqual({ name: 'inner' });
    });

    test('is undefined when no folder up to the root has a package.json', () => {
        expect(findProject('/work/app', manifestsAt({}))).toBeUndefined();
    });

    test('reads the manifests of the folders in order, nearest first', () => {
        const asked: string[] = [];

        findProject('/work/app', (dir) => {
            asked.push(dir);

            return undefined;
        });

        expect(asked).toEqual(['/work/app', '/work', '/']);
    });

    test('a relative folder is resolved before it is searched', () => {
        const asked: string[] = [];

        findProject('relative', (dir) => {
            asked.push(dir);

            return undefined;
        });

        expect(asked[0]).toBe(path.resolve('relative'));
    });
});

describe('resolveSettings', () => {
    test('a package.json with no "artemis" key uses the defaults', () => {
        expect(resolveSettings({ root: '/work/app', manifest: { name: 'app' } })).toEqual({
            bin: DEFAULT_BIN_NAME,
            commandsDir: '/work/app/commands'
        });
    });

    test('commandsDir is resolved from the project root, not from the current folder', () => {
        const project = {
            root: '/work/app',
            manifest: { artemis: { commandsDir: 'tools/commands' } }
        };

        expect(resolveSettings(project).commandsDir).toBe('/work/app/tools/commands');
    });

    test('an absolute commandsDir is kept as it is', () => {
        const project = {
            root: '/work/app',
            manifest: { artemis: { commandsDir: '/shared/commands' } }
        };

        expect(resolveSettings(project).commandsDir).toBe('/shared/commands');
    });

    test('an empty "artemis" key is the same as none', () => {
        expect(resolveSettings({ root: '/work/app', manifest: { artemis: {} } }).commandsDir).toBe(
            '/work/app/commands'
        );
    });

    test('the bin name comes from the configuration', () => {
        const project = { root: '/work/app', manifest: { artemis: { bin: 'mytool' } } };

        expect(resolveSettings(project).bin).toBe('mytool');
    });
});

describe('resolveSettings: a bad "artemis" key', () => {
    const bad = [
        { shape: 'a string', value: 'commands', problem: '"artemis" must be an object' },
        { shape: 'an array', value: [], problem: '"artemis" must be an object' },
        { shape: 'null', value: null, problem: '"artemis" must be an object' },
        { shape: 'a number', value: 5, problem: '"artemis" must be an object' },
        {
            shape: 'an empty commandsDir',
            value: { commandsDir: '' },
            problem: '"artemis".commandsDir must be a non-empty string'
        },
        {
            shape: 'a commandsDir that is not text',
            value: { commandsDir: 5 },
            problem: '"artemis".commandsDir must be a non-empty string'
        },
        {
            shape: 'an empty bin',
            value: { bin: '' },
            problem: '"artemis".bin must be a non-empty string'
        },
        {
            shape: 'a bin that is not text',
            value: { bin: ['mytool'] },
            problem: '"artemis".bin must be a non-empty string'
        }
    ];

    test.each(bad)('$shape names the problem and the file', ({ value, problem }) => {
        const project = { root: '/work/app', manifest: { artemis: value } };

        expect(thrownBy(() => resolveSettings(project))).toMatchObject({
            message: `${problem} (in /work/app/package.json)`
        });
    });

    test.each(bad)('$shape is a CommandError with a hint showing the valid shape', ({ value }) => {
        const project = { root: '/work/app', manifest: { artemis: value } };
        const error = thrownBy(() => resolveSettings(project));

        expect(error).toBeInstanceOf(CommandError);
        expect(error).toMatchObject({ hint: expect.stringContaining('"commandsDir"') });
    });
});

describe('resolveBinName', () => {
    test('the "artemis".bin setting comes first', () => {
        expect(resolveBinName({ artemis: { bin: 'chosen' }, bin: { other: 'x.js' } })).toBe(
            'chosen'
        );
    });

    test('then the single key of the project’s own "bin" field', () => {
        expect(resolveBinName({ bin: { mytool: 'bin/mytool.js' } })).toBe('mytool');
    });

    test('two keys in "bin" are ambiguous, so it falls back to the default', () => {
        expect(resolveBinName({ bin: { one: 'a.js', two: 'b.js' } })).toBe(DEFAULT_BIN_NAME);
    });

    test('an empty "bin" field falls back to the default', () => {
        expect(resolveBinName({ bin: {} })).toBe(DEFAULT_BIN_NAME);
    });

    test('a "bin" written as a plain string falls back to the default', () => {
        expect(resolveBinName({ bin: 'bin/mytool.js' })).toBe(DEFAULT_BIN_NAME);
    });

    test('with nothing at all it is the default', () => {
        expect(resolveBinName({})).toBe(DEFAULT_BIN_NAME);
    });
});
