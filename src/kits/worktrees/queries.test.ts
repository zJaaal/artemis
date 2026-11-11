import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createKitConfig } from '../../test/kit-config.js';
import { makeRepo } from '../../test/git.js';
import type { TempRepo } from '../../test/models.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import { FIRST_WORKTREE_SLOT } from './constants.js';
import {
    currentInstance,
    getInstance,
    instanceAt,
    listInstances,
    noInstanceError,
    pinnedName,
    rootOf
} from './queries.js';

const folders = createTempFolders();

let dir: string;
let main: TempRepo;

beforeEach(() => {
    dir = folders.make('artemis-queries-');
    main = makeRepo(path.join(dir, 'main'));
});

afterEach(() => folders.cleanUp());

describe('pinnedName', () => {
    test('is undefined when the app has no env variable', () => {
        expect(pinnedName(createKitConfig(dir, main.root, { env: { APP: 'x' } }))).toBeUndefined();
    });

    test('is undefined when the variable is not set', () => {
        expect(pinnedName(createKitConfig(dir, main.root, { envVar: 'APP' }))).toBeUndefined();
    });

    test('is undefined when the variable is empty', () => {
        const config = createKitConfig(dir, main.root, { envVar: 'APP', env: { APP: '' } });

        expect(pinnedName(config)).toBeUndefined();
    });

    test('is the value of the variable when it is set', () => {
        const config = createKitConfig(dir, main.root, { envVar: 'APP', env: { APP: 'pinned' } });

        expect(pinnedName(config)).toBe('pinned');
    });
});

describe('noInstanceError', () => {
    test('names the instance and hints how one gets registered', () => {
        expect(noInstanceError('ghost')).toMatchObject({
            message: 'There is no instance named "ghost".',
            hint: expect.stringContaining('first start')
        });
    });
});

describe('listInstances', () => {
    test('lists the main instance first, then the registered ones by slot', () => {
        const config = createKitConfig(dir, main.root);

        config.store.write({
            late: { slot: FIRST_WORKTREE_SLOT + 1, root: null },
            early: { slot: FIRST_WORKTREE_SLOT, root: null }
        });

        expect(listInstances(config).map((instance) => instance.name)).toEqual([
            'main',
            'early',
            'late'
        ]);
    });
});

describe('getInstance', () => {
    test('finds the main instance by its name', () => {
        expect(getInstance(createKitConfig(dir, main.root), 'main').isMain).toBe(true);
    });

    test('an unknown name is the no-instance error', () => {
        expect(thrownBy(() => getInstance(createKitConfig(dir, main.root), 'ghost'))).toMatchObject(
            {
                message: 'There is no instance named "ghost".'
            }
        );
    });
});

describe('rootOf and instanceAt', () => {
    test('the root of a folder inside a checkout is the checkout root', () => {
        expect(rootOf(createKitConfig(dir, main.root), path.join(main.root, 'marker'))).toBe(
            main.root
        );
    });

    test('a folder outside any repo has no root', () => {
        expect(rootOf(createKitConfig(dir, main.root), dir)).toBeNull();
    });

    test('the instance at the main root is the main one', () => {
        expect(instanceAt(createKitConfig(dir, main.root), main.root)?.isMain).toBe(true);
    });

    test('a root that nothing registered has no instance', () => {
        expect(
            instanceAt(createKitConfig(dir, main.root), path.join(dir, 'other'))
        ).toBeUndefined();
    });
});

describe('currentInstance', () => {
    test('is the pinned instance when the variable names one', () => {
        const config = createKitConfig(dir, main.root, { envVar: 'APP', env: { APP: 'main' } });

        expect(currentInstance(config, { cwd: dir }).name).toBe('main');
    });
});
