import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CommandError, UsageError } from '../../errors/errors.js';
import { makeRepo } from '../../test/git.js';
import { createKitConfig } from '../../test/kit-config.js';
import type { TempRepo } from '../../test/models.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import { FIRST_WORKTREE_SLOT } from './constants.js';
import { ensureDetachedInstance, ensureInstance, removeInstance } from './registration.js';

const folders = createTempFolders();

let dir: string;
let main: TempRepo;

beforeEach(() => {
    dir = folders.make('artemis-registration-');
    main = makeRepo(path.join(dir, 'main'));
});

afterEach(() => folders.cleanUp());

describe('ensureInstance', () => {
    test('registers a checkout named after its folder on the first free slot', () => {
        const config = createKitConfig(dir, main.root);
        const other = makeRepo(path.join(dir, 'Other_Checkout'));

        expect(ensureInstance(config, { cwd: other.root })).toMatchObject({
            name: 'other-checkout',
            slot: FIRST_WORKTREE_SLOT,
            root: other.root
        });
    });

    test('a root that is not a checkout is refused with a hint', () => {
        const config = createKitConfig(dir, main.root);

        expect(thrownBy(() => ensureInstance(config, { root: dir }))).toMatchObject({
            message: expect.stringContaining('is not a checkout of this app'),
            hint: 'Point it at the root of a worktree.'
        });
    });

    test('the pinned instance wins when no root or name is given', () => {
        const config = createKitConfig(dir, main.root, { envVar: 'APP', env: { APP: 'main' } });

        expect(ensureInstance(config, { cwd: dir }).name).toBe('main');
    });
});

describe('ensureDetachedInstance', () => {
    test('a name that belongs to a worktree is a usage error naming its root', () => {
        const config = createKitConfig(dir, main.root);

        config.store.write({ taken: { slot: FIRST_WORKTREE_SLOT, root: '/w/taken' } });

        expect(thrownBy(() => ensureDetachedInstance(config, { name: 'taken' }))).toMatchObject({
            message: 'Instance "taken" already belongs to /w/taken.'
        });
    });

    test('an invalid name is a usage error', () => {
        const config = createKitConfig(dir, main.root);

        expect(thrownBy(() => ensureDetachedInstance(config, { name: 'No Good' }))).toBeInstanceOf(
            UsageError
        );
    });

    test('registers on the first free slot, with no root', () => {
        const config = createKitConfig(dir, main.root);

        expect(ensureDetachedInstance(config, { name: 'qa' })).toMatchObject({
            slot: FIRST_WORKTREE_SLOT,
            root: null
        });
    });
});

describe('removeInstance', () => {
    test('forgets a registered instance', () => {
        const config = createKitConfig(dir, main.root);

        ensureDetachedInstance(config, { name: 'qa' });
        removeInstance(config, 'qa');

        expect(config.store.read()).toEqual({});
    });

    test('an unknown instance is the no-instance error', () => {
        const config = createKitConfig(dir, main.root);

        expect(thrownBy(() => removeInstance(config, 'ghost'))).toMatchObject({
            message: 'There is no instance named "ghost".'
        });
    });

    test('the main instance cannot be removed', () => {
        const config = createKitConfig(dir, main.root);

        expect(thrownBy(() => removeInstance(config, 'main'))).toBeInstanceOf(CommandError);
    });
});
