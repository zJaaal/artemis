import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { DEFAULT_BIN_NAME } from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type { IsFolderFn, ReadManifestFn } from '../models.js';
import { thrownBy } from '../test/thrown.js';
import { findProject, resolveBinName, resolveSettings } from './settings.js';

/** Manifests by folder: the only "files" the pure code gets to see. Folders in `broken` cannot be read. */
const manifestsAt =
    (manifests: Record<string, Record<string, unknown>>, ...broken: string[]): ReadManifestFn =>
    (dir) => {
        if (broken.includes(dir)) {
            return { error: new CommandError(`Cannot read ${dir}/package.json`) };
        }

        const manifest = manifests[dir];

        return manifest ? { manifest } : undefined;
    };

/** The folders that exist, named in full. */
const foldersAt =
    (...folders: string[]): IsFolderFn =>
    (target) =>
        folders.includes(target);

const noFolders = foldersAt();

describe('findProject: what counts as a project', () => {
    test('a package.json with a name is a project, with or without a commands folder', () => {
        const project = findProject(
            '/work/app',
            manifestsAt({ '/work/app': { name: 'app' } }),
            noFolders
        );

        expect(project).toEqual({ root: '/work/app', manifest: { name: 'app' } });
    });

    test('an unnamed package.json with a commands folder next to it is a project (a monorepo root)', () => {
        const project = findProject(
            '/work',
            manifestsAt({ '/work': { private: true, workspaces: ['packages/*'] } }),
            foldersAt('/work/commands')
        );

        expect(project?.root).toBe('/work');
    });

    test('an unnamed package.json with an "artemis" key is a project', () => {
        const manifest = { artemis: { commandsDir: 'tools' } };

        expect(
            findProject('/work/app', manifestsAt({ '/work/app': manifest }), noFolders)?.root
        ).toBe('/work/app');
    });

    test('a bare marker, such as a type marker in src, is skipped', () => {
        const project = findProject(
            '/work/app/src',
            manifestsAt({ '/work/app': { name: 'app' }, '/work/app/src': { type: 'module' } }),
            noFolders
        );

        expect(project?.root).toBe('/work/app');
    });

    test('a marker in dist next to a tool’s bin file is skipped, and the tool’s own package is found', () => {
        const project = findProject(
            '/tool/dist',
            manifestsAt({ '/tool': { name: 'tool' }, '/tool/dist': { type: 'module' } }),
            noFolders
        );

        expect(project?.root).toBe('/tool');
    });

    test('a named package without commands is the project, so the failure is about its own commands', () => {
        const project = findProject(
            '/work/packages/inner',
            manifestsAt({ '/work': { name: 'outer' }, '/work/packages/inner': { name: 'inner' } }),
            foldersAt('/work/commands')
        );

        expect(project?.root).toBe('/work/packages/inner');
    });

    test('is undefined when only markers exist', () => {
        const project = findProject(
            '/work/app',
            manifestsAt({ '/work/app': { type: 'module' }, '/work': { private: true } }),
            noFolders
        );

        expect(project).toBeUndefined();
    });

    test('a package.json with an empty name is not named', () => {
        expect(
            findProject('/work/app', manifestsAt({ '/work/app': { name: '' } }), noFolders)
        ).toBeUndefined();
    });
});

describe('findProject: where it looks', () => {
    test('walks up to a parent folder when the current one has no package.json', () => {
        const project = findProject(
            '/work/app/src/deep',
            manifestsAt({ '/work/app': { name: 'app' } }),
            noFolders
        );

        expect(project?.root).toBe('/work/app');
    });

    test('the nearest project wins over one in a parent folder', () => {
        const project = findProject(
            '/work/packages/inner/src',
            manifestsAt({ '/work': { name: 'outer' }, '/work/packages/inner': { name: 'inner' } }),
            noFolders
        );

        expect(project?.root).toBe('/work/packages/inner');
    });

    test('never climbs out of a tool’s own package into the project that installed it', () => {
        const project = findProject(
            '/app/node_modules/mytool/bin',
            manifestsAt({
                '/app/node_modules/mytool': { name: 'mytool' },
                '/app': { name: 'app' }
            }),
            noFolders
        );

        expect(project?.root).toBe('/app/node_modules/mytool');
    });

    test('reads the manifests of the folders in order, nearest first', () => {
        const asked: string[] = [];

        findProject(
            '/work/app',
            (dir) => {
                asked.push(dir);

                return undefined;
            },
            noFolders
        );

        expect(asked).toEqual(['/work/app', '/work', '/']);
    });

    test('a relative folder is resolved before it is searched', () => {
        const asked: string[] = [];

        findProject(
            'relative',
            (dir) => {
                asked.push(dir);

                return undefined;
            },
            noFolders
        );

        expect(asked[0]).toBe(path.resolve('relative'));
    });

    test('is undefined when there is no package.json at all', () => {
        expect(findProject('/somewhere/bin', manifestsAt({}), noFolders)).toBeUndefined();
    });
});

describe('findProject: a package.json that cannot be read', () => {
    test('is an error, even when it is not the project, so a different project is never run silently', () => {
        const search = () =>
            findProject(
                '/work/app/templates',
                manifestsAt({ '/work/app': { name: 'app' } }, '/work/app/templates'),
                noFolders
            );

        expect(thrownBy(search)).toMatchObject({
            message: 'Cannot read /work/app/templates/package.json'
        });
    });

    test('is an error when it would have been the project', () => {
        const search = () =>
            findProject('/work/app', manifestsAt({}, '/work/app'), foldersAt('/work/app/commands'));

        expect(thrownBy(search)).toBeInstanceOf(CommandError);
    });

    test('above the project it is never looked at, because the search has already stopped', () => {
        const project = findProject(
            '/work/app',
            manifestsAt({ '/work/app': { name: 'app' } }, '/work'),
            noFolders
        );

        expect(project?.root).toBe('/work/app');
    });
});

describe('resolveSettings', () => {
    test('a package.json with no "artemis" key uses the defaults', () => {
        expect(
            resolveSettings({ root: '/work/app', manifest: { name: 'app' } }, 'shipped')
        ).toEqual({
            bin: DEFAULT_BIN_NAME,
            commandsDir: '/work/app/commands'
        });
    });

    test('commandsDir is resolved from the project root, not from the current folder', () => {
        const project = {
            root: '/work/app',
            manifest: { artemis: { commandsDir: 'tools/commands' } }
        };

        expect(resolveSettings(project, 'shipped').commandsDir).toBe('/work/app/tools/commands');
    });

    test('an absolute commandsDir is kept as it is', () => {
        const project = {
            root: '/work/app',
            manifest: { artemis: { commandsDir: '/shared/commands' } }
        };

        expect(resolveSettings(project, 'shipped').commandsDir).toBe('/shared/commands');
    });

    test('an empty "artemis" key is the same as none', () => {
        const project = { root: '/work/app', manifest: { artemis: {} } };

        expect(resolveSettings(project, 'shipped').commandsDir).toBe('/work/app/commands');
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

        expect(thrownBy(() => resolveSettings(project, 'shipped'))).toMatchObject({
            message: `${problem} (in /work/app/package.json)`
        });
    });

    test.each(bad)('$shape is a CommandError with a hint showing the valid shape', ({ value }) => {
        const project = { root: '/work/app', manifest: { artemis: value } };
        const error = thrownBy(() => resolveSettings(project, 'shipped'));

        expect(error).toBeInstanceOf(CommandError);
        expect(error).toMatchObject({ hint: expect.stringContaining('"commandsDir"') });
    });
});

describe('resolveBinName: the shipped binary', () => {
    test('shows the "artemis".bin setting when there is one', () => {
        expect(resolveBinName({ bin: 'chosen' }, {}, 'shipped')).toBe('chosen');
    });

    test('shows art, never the name of an unrelated CLI the project publishes', () => {
        expect(resolveBinName({}, { bin: { foo: 'bin/foo.js' } }, 'shipped')).toBe(
            DEFAULT_BIN_NAME
        );
    });

    test('shows art for a project whose bin is a string, too', () => {
        expect(resolveBinName({}, { name: 'foo', bin: 'bin/foo.js' }, 'shipped')).toBe(
            DEFAULT_BIN_NAME
        );
    });
});

describe('resolveBinName: a project’s own bin file', () => {
    test('the "artemis".bin setting comes first', () => {
        expect(resolveBinName({ bin: 'chosen' }, { bin: { other: 'x.js' } }, 'own')).toBe('chosen');
    });

    test('then the single key of the project’s own "bin" object', () => {
        expect(resolveBinName({}, { bin: { mytool: 'bin/mytool.js' } }, 'own')).toBe('mytool');
    });

    test('several keys in "bin" are named after the package, which these users have', () => {
        const manifest = { name: '@acme/mytool', bin: { mytool: 'a.js', mt: 'b.js' } };

        expect(resolveBinName({}, manifest, 'own')).toBe('mytool');
    });

    test('several keys and no package name fall back to the default', () => {
        expect(resolveBinName({}, { bin: { one: 'a.js', two: 'b.js' } }, 'own')).toBe(
            DEFAULT_BIN_NAME
        );
    });

    test('a package without a bin field has no name of its own, so it is the default', () => {
        expect(resolveBinName({}, { name: 'mytool' }, 'own')).toBe(DEFAULT_BIN_NAME);
    });

    test('a "bin" written as a string is named after the package', () => {
        expect(resolveBinName({}, { name: 'mytool', bin: 'bin/mytool.js' }, 'own')).toBe('mytool');
    });

    test('a scoped package name loses its scope, like npm names the command', () => {
        expect(resolveBinName({}, { name: '@acme/mytool', bin: 'bin/mytool.js' }, 'own')).toBe(
            'mytool'
        );
    });

    test('a string "bin" with no package name falls back to the default', () => {
        expect(resolveBinName({}, { bin: 'bin/mytool.js' }, 'own')).toBe(DEFAULT_BIN_NAME);
    });

    test('an empty "bin" object falls back to the default', () => {
        expect(resolveBinName({}, { name: 'mytool', bin: {} }, 'own')).toBe(DEFAULT_BIN_NAME);
    });

    test('with nothing at all it is the default', () => {
        expect(resolveBinName({}, {}, 'own')).toBe(DEFAULT_BIN_NAME);
    });
});

describe('resolveSettings: the bin name comes from the checked configuration', () => {
    test('the shipped route shows the configured name', () => {
        const project = { root: '/work/app', manifest: { artemis: { bin: 'mytool' } } };

        expect(resolveSettings(project, 'shipped').bin).toBe('mytool');
    });

    test('the own route shows the name of its bin field', () => {
        const project = { root: '/work/app', manifest: { bin: { mytool: 'bin/mytool.js' } } };

        expect(resolveSettings(project, 'own').bin).toBe('mytool');
    });
});
