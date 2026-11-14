import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { AUDIT_FILE_NAME, DEFAULT_BIN_NAME } from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type { IsFolderFn, ReadManifestFn } from '../models.js';
import { at } from '../test/paths.js';
import { thrownBy } from '../test/thrown.js';
import {
    findProject,
    resolveAuditFile,
    resolveBinName,
    resolveSettings,
    resolveStateDir
} from './settings.js';

/** Manifests by folder: the only "files" the pure code gets to see. Folders in `broken` cannot be read. */
const manifestsAt =
    (manifests: Record<string, Record<string, unknown>>, ...broken: string[]): ReadManifestFn =>
    (dir) => {
        if (broken.includes(dir)) {
            return { error: new CommandError(`Cannot read ${dir}/package.json`) };
        }

        const manifest = manifests[dir];

        return manifest ? { manifest, text: JSON.stringify(manifest) } : undefined;
    };

/** The folders that exist, named in full. */
const foldersAt =
    (...folders: string[]): IsFolderFn =>
    (target) =>
        folders.includes(target);

const noFolders = foldersAt();

/** What a person running the shipped art looks for. */
const shipped = (cwd: string, readManifest: ReadManifestFn, isFolder: IsFolderFn) =>
    findProject(cwd, readManifest, isFolder, 'shipped');

/** What a tool's bin file looks for. */
const own = (cwd: string, readManifest: ReadManifestFn) =>
    findProject(cwd, readManifest, noFolders, 'own');

describe('findProject, shipped route: what counts as a project', () => {
    test('a package.json with an "artemis" key declares a project, even with no commands folder', () => {
        const manifest = { artemis: { commandsDir: 'tools' } };

        expect(
            shipped(at('/work/app'), manifestsAt({ [at('/work/app')]: manifest }), noFolders)?.root
        ).toBe(at('/work/app'));
    });

    test('a package.json with a commands folder next to it is a project, with no setup', () => {
        const project = shipped(
            at('/work/app'),
            manifestsAt({ [at('/work/app')]: { name: 'app' } }),
            foldersAt(at('/work/app/commands'))
        );

        expect(project).toEqual({ root: at('/work/app'), manifest: { name: 'app' } });
    });

    test('an unnamed package.json with a commands folder is a project too', () => {
        const project = shipped(
            at('/work'),
            manifestsAt({ [at('/work')]: { private: true, workspaces: ['packages/*'] } }),
            foldersAt(at('/work/commands'))
        );

        expect(project?.root).toBe(at('/work'));
    });

    test('a package.json with neither signal is not a candidate, whatever it says', () => {
        const project = shipped(
            at('/work/app'),
            manifestsAt({ [at('/work/app')]: { name: 'app', version: '1.0.0' } }),
            noFolders
        );

        expect(project).toBeUndefined();
    });

    test('a type marker in src is skipped', () => {
        const project = shipped(
            at('/work/app/src'),
            manifestsAt({
                [at('/work/app')]: { name: 'app' },
                [at('/work/app/src')]: { type: 'module' }
            }),
            foldersAt(at('/work/app/commands'))
        );

        expect(project?.root).toBe(at('/work/app'));
    });

    test('a marker with extra keys, such as sideEffects, is skipped too: no marker shape needs a rule', () => {
        const project = shipped(
            at('/work/app/dist/esm'),
            manifestsAt({
                [at('/work/app')]: { name: 'app' },
                [at('/work/app/dist/esm')]: { type: 'module', sideEffects: false }
            }),
            foldersAt(at('/work/app/commands'))
        );

        expect(project?.root).toBe(at('/work/app'));
    });

    test('a template package.json, even valid JSON with a name, is skipped', () => {
        const project = shipped(
            at('/work/app/templates'),
            manifestsAt({
                [at('/work/app')]: { name: 'app' },
                [at('/work/app/templates')]: { name: '{{name}}' }
            }),
            foldersAt(at('/work/app/commands'))
        );

        expect(project?.root).toBe(at('/work/app'));
    });

    test('a monorepo package with no commands and no key uses the root’s commands', () => {
        const project = shipped(
            at('/work/packages/web'),
            manifestsAt({
                [at('/work')]: { name: 'root' },
                [at('/work/packages/web')]: { name: 'web' }
            }),
            foldersAt(at('/work/commands'))
        );

        expect(project?.root).toBe(at('/work'));
    });
});

describe('findProject, shipped route: where it looks', () => {
    test('walks up to a parent folder when the current one has no package.json', () => {
        const project = shipped(
            at('/work/app/src/deep'),
            manifestsAt({ [at('/work/app')]: { name: 'app' } }),
            foldersAt(at('/work/app/commands'))
        );

        expect(project?.root).toBe(at('/work/app'));
    });

    test('the nearest project wins over one in a parent folder', () => {
        const project = shipped(
            at('/work/packages/inner/src'),
            manifestsAt({
                [at('/work')]: { name: 'outer' },
                [at('/work/packages/inner')]: { name: 'inner' }
            }),
            foldersAt(at('/work/commands'), at('/work/packages/inner/commands'))
        );

        expect(project?.root).toBe(at('/work/packages/inner'));
    });

    test('reads the manifests of the folders in order, nearest first', () => {
        const asked: string[] = [];

        shipped(
            at('/work/app'),
            (dir) => {
                asked.push(dir);

                return undefined;
            },
            noFolders
        );

        expect(asked).toEqual([at('/work/app'), at('/work'), at('/')]);
    });

    test('a relative folder is resolved before it is searched', () => {
        const asked: string[] = [];

        shipped(
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
        expect(shipped('/somewhere', manifestsAt({}), noFolders)).toBeUndefined();
    });
});

describe('findProject: a package.json that cannot be read', () => {
    test('is an error even when it is not a candidate, so a different project is never run silently', () => {
        const search = () =>
            shipped(
                at('/work/app/templates'),
                manifestsAt({ [at('/work/app')]: { name: 'app' } }, at('/work/app/templates')),
                foldersAt(at('/work/app/commands'))
            );

        expect(thrownBy(search)).toMatchObject({
            message: `Cannot read ${at('/work/app/templates')}${path.sep}package.json`
        });
    });

    test('is an error when it is the project', () => {
        const search = () =>
            shipped(
                at('/work/app'),
                manifestsAt({}, at('/work/app')),
                foldersAt(at('/work/app/commands'))
            );

        expect(thrownBy(search)).toBeInstanceOf(CommandError);
    });

    test('above the project it is never looked at, because the search has already stopped', () => {
        const project = shipped(
            at('/work/app'),
            manifestsAt({ [at('/work/app')]: { artemis: {} } }, at('/work')),
            noFolders
        );

        expect(project?.root).toBe(at('/work/app'));
    });

    test('is an error on the own route too', () => {
        const search = () =>
            own('/app/node_modules/mytool/bin', manifestsAt({}, '/app/node_modules/mytool'));

        expect(thrownBy(search)).toBeInstanceOf(CommandError);
    });
});

describe('findProject, own route: a tool’s bin file', () => {
    const tool = { name: 'mytool', bin: { mytool: 'bin/mytool.js' } };
    const installed = '/app/node_modules/mytool';

    test('the nearest package.json with a name, a bin or an artemis key is the tool’s package', () => {
        const project = own(`${installed}/bin`, manifestsAt({ [installed]: tool }));

        expect(project?.root).toBe(installed);
    });

    test('a bin written as a string declares one too', () => {
        const project = own('/tool/bin', manifestsAt({ '/tool': { bin: 'bin/mytool.js' } }));

        expect(project?.root).toBe('/tool');
    });

    test('a tool that declares no bin is still its own package: a name is enough', () => {
        const project = own(
            at('/work/tool/bin'),
            manifestsAt({ [at('/work/tool')]: { name: 'mytool' } })
        );

        expect(project?.root).toBe(at('/work/tool'));
    });

    test('a tool without a bin never climbs into a host that declares one', () => {
        const project = own(
            at('/work/tool/bin'),
            manifestsAt({
                [at('/work/tool')]: { name: 'mytool' },
                [at('/work')]: { name: 'host', bin: { host: 'h.js' } }
            })
        );

        expect(project?.root).toBe(at('/work/tool'));
    });

    test('a marker in dist next to the bin file is skipped, with any extra keys', () => {
        const project = own(
            '/tool/dist',
            manifestsAt({ '/tool': tool, '/tool/dist': { type: 'module', sideEffects: false } })
        );

        expect(project?.root).toBe('/tool');
    });

    test('a template without a name, bin or key is skipped too', () => {
        const project = own(
            '/tool/templates/bin',
            manifestsAt({ '/tool': tool, '/tool/templates': { private: true } })
        );

        expect(project?.root).toBe('/tool');
    });

    test('never climbs into the project that installed the tool', () => {
        const project = own(
            `${installed}/bin`,
            manifestsAt({ [installed]: tool, '/app': { name: 'app', artemis: {} } })
        );

        expect(project?.root).toBe(installed);
    });

    test('an installed package is its own package even when its package.json has no identity', () => {
        const project = own(
            `${installed}/bin`,
            manifestsAt({
                [installed]: { private: true },
                '/app': { name: 'app', bin: { app: 'a.js' } }
            })
        );

        expect(project?.root).toBe(installed);
    });

    test('the same for a scoped package: node_modules/@scope/pkg', () => {
        const scoped = '/app/node_modules/@acme/mytool';

        const project = own(
            `${scoped}/bin`,
            manifestsAt({ [scoped]: { private: true }, '/app': { name: 'app', artemis: {} } })
        );

        expect(project?.root).toBe(scoped);
    });

    test('an installed package with no readable package.json has no project, and the host is not tried', () => {
        const project = own(
            `${installed}/bin`,
            manifestsAt({ '/app': { name: 'app', artemis: {} } })
        );

        expect(project).toBeUndefined();
    });

    test('a host that only follows the commands convention is not the tool', () => {
        expect(own(at('/work/bin'), manifestsAt({}))).toBeUndefined();
    });

    test('an empty bin declares nothing, and without a name or key it is not a tool package', () => {
        expect(own('/tool/bin', manifestsAt({ '/tool': { bin: {} } }))).toBeUndefined();
    });

    test('is undefined when no package.json has an identity', () => {
        expect(own('/somewhere/bin', manifestsAt({}))).toBeUndefined();
    });
});

describe('resolveSettings', () => {
    test('a package.json with no "artemis" key uses the defaults', () => {
        expect(
            resolveSettings({ root: at('/work/app'), manifest: { name: 'app' } }, 'shipped')
        ).toEqual({
            bin: DEFAULT_BIN_NAME,
            commandsDir: at('/work/app/commands')
        });
    });

    test('commandsDir is resolved from the project root, not from the current folder', () => {
        const project = {
            root: at('/work/app'),
            manifest: { artemis: { commandsDir: 'tools/commands' } }
        };

        expect(resolveSettings(project, 'shipped').commandsDir).toBe(
            at('/work/app/tools/commands')
        );
    });

    test('an absolute commandsDir is kept as it is', () => {
        const project = {
            root: at('/work/app'),
            manifest: { artemis: { commandsDir: '/shared/commands' } }
        };

        expect(resolveSettings(project, 'shipped').commandsDir).toBe('/shared/commands');
    });

    test('an empty "artemis" key is the same as none', () => {
        const project = { root: at('/work/app'), manifest: { artemis: {} } };

        expect(resolveSettings(project, 'shipped').commandsDir).toBe(at('/work/app/commands'));
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
            shape: 'an empty stateDir',
            value: { stateDir: '' },
            problem: '"artemis".stateDir must be a non-empty string'
        },
        {
            shape: 'a stateDir that is not text',
            value: { stateDir: 5 },
            problem: '"artemis".stateDir must be a non-empty string'
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
        const project = { root: at('/work/app'), manifest: { artemis: value } };

        expect(thrownBy(() => resolveSettings(project, 'shipped'))).toMatchObject({
            message: `${problem} (in ${at('/work/app/package.json')})`
        });
    });

    test.each(bad)('$shape is a CommandError with a hint showing the valid shape', ({ value }) => {
        const project = { root: at('/work/app'), manifest: { artemis: value } };
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
        const project = { root: at('/work/app'), manifest: { artemis: { bin: 'mytool' } } };

        expect(resolveSettings(project, 'shipped').bin).toBe('mytool');
    });

    test('the own route shows the name of its bin field', () => {
        const project = { root: at('/work/app'), manifest: { bin: { mytool: 'bin/mytool.js' } } };

        expect(resolveSettings(project, 'own').bin).toBe('mytool');
    });
});

describe('resolveStateDir', () => {
    test('defaults to <root>/state', () => {
        expect(resolveStateDir({ root: at('/work/app'), manifest: { name: 'app' } })).toBe(
            at('/work/app/state')
        );
    });

    test('"artemis".stateDir is resolved from the project root', () => {
        const project = { root: at('/work/app'), manifest: { artemis: { stateDir: 'data' } } };

        expect(resolveStateDir(project)).toBe(at('/work/app/data'));
    });

    test('an absolute stateDir is kept as it is', () => {
        const project = {
            root: at('/work/app'),
            manifest: { artemis: { stateDir: '/var/app-state' } }
        };

        expect(resolveStateDir(project)).toBe('/var/app-state');
    });

    test('a stateDir with no commandsDir leaves the commands folder at its default', () => {
        const project = { root: at('/work/app'), manifest: { artemis: { stateDir: 'data' } } };

        expect(resolveSettings(project, 'shipped').commandsDir).toBe(at('/work/app/commands'));
    });

    test('a bad "artemis" key is the same CommandError as for the other settings', () => {
        const project = { root: at('/work/app'), manifest: { artemis: { stateDir: 5 } } };

        expect(thrownBy(() => resolveStateDir(project))).toMatchObject({
            message: `"artemis".stateDir must be a non-empty string (in ${at('/work/app/package.json')})`
        });
    });
});

describe('resolveAuditFile', () => {
    const root = path.resolve('work', 'app');
    const trail = path.join(root, 'state', AUDIT_FILE_NAME);

    const withAudit = (audit?: boolean) => ({
        root,
        manifest: { name: 'app', artemis: audit === undefined ? {} : { audit } }
    });

    test('shipped route: on when the project says nothing', () => {
        expect(resolveAuditFile(withAudit(), 'shipped')).toBe(trail);
    });

    test('shipped route: true is the same as saying nothing', () => {
        expect(resolveAuditFile(withAudit(true), 'shipped')).toBe(trail);
    });

    test('shipped route: off with "audit": false', () => {
        expect(resolveAuditFile(withAudit(false), 'shipped')).toBeUndefined();
    });

    test('own route: off when the tool says nothing', () => {
        expect(resolveAuditFile(withAudit(), 'own')).toBeUndefined();
    });

    test('own route: on only with "audit": true, in the state folder of the tool', () => {
        expect(resolveAuditFile(withAudit(true), 'own')).toBe(trail);
    });

    test('own route: off with "audit": false', () => {
        expect(resolveAuditFile(withAudit(false), 'own')).toBeUndefined();
    });

    test('own route: follows the stateDir of the tool', () => {
        const project = { root, manifest: { artemis: { audit: true, stateDir: 'data' } } };

        expect(resolveAuditFile(project, 'own')).toBe(path.join(root, 'data', AUDIT_FILE_NAME));
    });

    test.each(['own', 'shipped'] as const)(
        'a value that is not true or false is the invalid-config error on the %s route',
        (route) => {
            const project = { root, manifest: { artemis: { audit: 'yes' } } };

            expect(thrownBy(() => resolveAuditFile(project, route))).toBeInstanceOf(CommandError);
        }
    );
});
