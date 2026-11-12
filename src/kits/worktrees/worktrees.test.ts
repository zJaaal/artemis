import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CommandError, UsageError } from '../../errors/errors.js';
import {
    KIT_BASE_PORTS,
    KIT_COLORS,
    KIT_LOCK_TIMEOUT_MS,
    KIT_SLOT_STEP,
    TEMP_REPO_MARKER
} from '../../test/constants.js';
import { addWorktree, git, makeRepo } from '../../test/git.js';
import { createFakeLockOptions } from '../../test/lock-edges.js';
import type { TempRepo } from '../../test/models.js';
import { createTempFolders } from '../../test/temp.js';
import { thrownBy } from '../../test/thrown.js';
import { LOCK_SUFFIX } from '../store/constants.js';
import { FIRST_WORKTREE_SLOT } from './constants.js';
import type { LockOptions } from '../store/models.js';
import { defineStore } from '../store/store.js';
import type { WorktreesOptions } from './models.js';
import { defineWorktrees } from './worktrees.js';

const folders = createTempFolders();

const BASE_PORTS = KIT_BASE_PORTS;
const SLOT_STEP = KIT_SLOT_STEP;
const COLORS = [...KIT_COLORS];

/** Where a slot's ports land: the base port shifted by the step. */
const portsAt = (slot: number) => ({
    http: BASE_PORTS.http + slot * SLOT_STEP,
    frontend: BASE_PORTS.frontend + slot * SLOT_STEP
});

const ENV_VAR = 'APP_WORKTREE';
const HOLDER_PID = 4242;

let dir: string;
let main: TempRepo;

beforeEach(() => {
    dir = folders.make('artemis-wt-');
    main = makeRepo(path.join(dir, 'main'));
});

afterEach(() => folders.cleanUp());

const stateFile = () => path.join(dir, 'state', 'worktrees.json');

/** The registry document an app would keep, in a store over a real folder. */
const registry = (lockOptions: LockOptions = {}) =>
    defineStore({ dir: path.dirname(stateFile()), ...lockOptions }).doc('worktrees', {
        fallback: {}
    });

/** The kit as an app would configure it: a marker folder makes a repo a checkout. */
const kit = (overrides: Partial<WorktreesOptions> = {}) =>
    defineWorktrees({
        registry: registry(),
        envVar: ENV_VAR,
        mainCheckout: main.root,
        isCheckout: (root) => fs.existsSync(path.join(root, TEMP_REPO_MARKER)),
        ports: BASE_PORTS,
        slotStep: SLOT_STEP,
        colors: COLORS,
        env: {},
        ...overrides
    });

const worktree = (name: string) => addWorktree(main, path.join(dir, name));

/** A checkout with the same folder name as another, living somewhere else. */
const lookalike = (name: string) => {
    fs.mkdirSync(path.join(dir, 'elsewhere'), { recursive: true });

    return makeRepo(path.join(dir, 'elsewhere', name)).root;
};

describe('current', () => {
    test('outside any checkout, the main worktree is current', () => {
        expect(kit().current({ cwd: dir })).toMatchObject({
            name: 'main',
            isMain: true,
            ports: BASE_PORTS,
            color: 'blue'
        });
    });

    test('inside the main checkout, the main worktree is current', () => {
        expect(kit().current({ cwd: path.join(main.root, TEMP_REPO_MARKER) }).isMain).toBe(true);
    });

    test('a worktree without a registration refuses, with a hint', () => {
        const root = worktree('feat-a');
        const error = thrownBy(() => kit().current({ cwd: root }));

        expect(error).toBeInstanceOf(CommandError);

        expect(error).toMatchObject({
            message: expect.stringMatching(/no instance yet/),
            hint: expect.any(String)
        });
    });

    test('the hint of a refusal names the env variable that can pin another instance', () => {
        const root = worktree('feat-a');

        expect(thrownBy(() => kit().current({ cwd: root }))).toMatchObject({
            hint: expect.stringContaining(ENV_VAR)
        });
    });

    test('a repo that is not a checkout of the app counts as outside one', () => {
        const other = path.join(dir, 'other');

        fs.mkdirSync(other);
        git(other, 'init', '-q');

        expect(kit().current({ cwd: fs.realpathSync(other) }).isMain).toBe(true);
    });
});

describe('ensure', () => {
    test('registers the worktree it runs in, named after its folder, on the next slot', () => {
        const root = worktree('Feat_A');

        expect(kit().ensure({ cwd: path.join(root, TEMP_REPO_MARKER) })).toEqual({
            name: 'feat-a',
            slot: FIRST_WORKTREE_SLOT,
            root,
            isMain: false,
            meta: {},
            color: 'green',
            ports: portsAt(FIRST_WORKTREE_SLOT)
        });
    });

    test('ensuring again returns the same instance', () => {
        const root = worktree('Feat_A');
        const created = kit().ensure({ cwd: root });

        expect(kit().ensure({ cwd: root })).toEqual(created);
    });

    test('current finds the registered worktree from a folder inside it', () => {
        const root = worktree('Feat_A');
        const created = kit().ensure({ cwd: root });

        expect(kit().current({ cwd: path.join(root, TEMP_REPO_MARKER) })).toEqual(created);
    });

    test('a folder name that is already taken gets a numeric suffix', () => {
        const first = worktree('feat');
        const second = lookalike('feat');

        kit().ensure({ cwd: first });

        expect(kit().ensure({ cwd: second }).name).toBe('feat-2');
    });

    test('an explicit name is used when it is free', () => {
        expect(kit().ensure({ cwd: worktree('one'), name: 'chosen' }).name).toBe('chosen');
    });

    test('an explicit name taken by another worktree is a usage error', () => {
        kit().ensure({ cwd: worktree('one') });

        expect(thrownBy(() => kit().ensure({ cwd: worktree('two'), name: 'one' }))).toBeInstanceOf(
            UsageError
        );
    });

    test('an explicit name that is not valid is a usage error with a hint', () => {
        expect(
            thrownBy(() => kit().ensure({ cwd: worktree('one'), name: 'Bad Name' }))
        ).toMatchObject({ hint: expect.stringContaining('lowercase') });
    });

    test('the main name cannot be taken by another worktree', () => {
        expect(thrownBy(() => kit().ensure({ cwd: worktree('one'), name: 'main' }))).toBeInstanceOf(
            UsageError
        );
    });

    test('a worktree already registered under another name cannot be renamed by ensure', () => {
        const root = worktree('one');

        kit().ensure({ cwd: root });

        expect(thrownBy(() => kit().ensure({ cwd: root, name: 'other' }))).toMatchObject({
            message: expect.stringContaining('already registered as "one"')
        });
    });

    test('accepts a root from elsewhere', () => {
        const root = worktree('remote');

        expect(kit().ensure({ cwd: dir, root }).name).toBe('remote');
    });

    test('rejects a folder that is not a checkout', () => {
        expect(thrownBy(() => kit().ensure({ cwd: dir, root: dir }))).toBeInstanceOf(CommandError);
    });

    test('outside any checkout with no name, it is the current instance', () => {
        expect(kit().ensure({ cwd: dir }).isMain).toBe(true);
    });

    test('outside any checkout, an unknown name needs a worktree', () => {
        expect(thrownBy(() => kit().ensure({ cwd: dir, name: 'nowhere' }))).toBeInstanceOf(
            UsageError
        );
    });
});

describe('the env variable', () => {
    test('overrides the folder', () => {
        kit().ensure({ cwd: worktree('pinned') });

        expect(kit({ env: { [ENV_VAR]: 'pinned' } }).current({ cwd: dir }).name).toBe('pinned');
    });

    test('an unknown name fails', () => {
        expect(
            thrownBy(() => kit({ env: { [ENV_VAR]: 'nope' } }).current({ cwd: dir }))
        ).toBeInstanceOf(CommandError);
    });

    test('ensure with no name or root returns the pinned instance', () => {
        kit().ensure({ cwd: worktree('pinned') });

        expect(kit({ env: { [ENV_VAR]: 'pinned' } }).ensure({ cwd: dir }).name).toBe('pinned');
    });
});

describe('remove', () => {
    test('frees the slot for the next worktree', () => {
        kit().ensure({ cwd: worktree('gone') });
        kit().remove('gone');

        expect(kit().ensure({ cwd: worktree('next') }).slot).toBe(FIRST_WORKTREE_SLOT);
    });

    test('forgets the instance without listing it again', () => {
        kit().ensure({ cwd: worktree('gone') });
        kit().remove('gone');

        expect(
            kit()
                .list()
                .map((instance) => instance.name)
        ).toEqual(['main']);
    });

    test('the main worktree cannot be removed', () => {
        expect(thrownBy(() => kit().remove('main'))).toBeInstanceOf(CommandError);
    });

    test('removing an unknown instance fails with a hint', () => {
        expect(thrownBy(() => kit().remove('ghost'))).toMatchObject({
            message: 'There is no instance named "ghost".',
            hint: expect.any(String)
        });
    });

    test('never touches the worktree itself', () => {
        const root = worktree('keep');

        kit().ensure({ cwd: root });
        kit().remove('keep');

        expect(fs.existsSync(root)).toBe(true);
    });
});

describe('detached instances', () => {
    test('belong to no checkout, get the next slot and keep their metadata', () => {
        kit().ensure({ cwd: worktree('feat') });

        expect(
            kit().ensureDetached({ name: 'trunk-c467', meta: { image: 'x/y:trunk_c467' } })
        ).toEqual({
            name: 'trunk-c467',
            slot: FIRST_WORKTREE_SLOT + 1,
            root: null,
            isMain: false,
            meta: { image: 'x/y:trunk_c467' },
            color: 'magenta',
            ports: portsAt(FIRST_WORKTREE_SLOT + 1)
        });
    });

    test('can be read back by name', () => {
        const detached = kit().ensureDetached({ name: 'trunk-c467', meta: { image: 'a:1' } });

        expect(kit().get('trunk-c467')).toEqual(detached);
    });

    test('ensuring again returns the same slot, with updated metadata', () => {
        const first = kit().ensureDetached({ name: 'qa', meta: { image: 'a:1' } });
        const again = kit().ensureDetached({ name: 'qa', meta: { image: 'a:2' } });

        expect(again).toMatchObject({ slot: first.slot, meta: { image: 'a:2' } });
    });

    test('ensuring again does not register a second instance', () => {
        kit().ensureDetached({ name: 'qa', meta: { image: 'a:1' } });
        kit().ensureDetached({ name: 'qa', meta: { image: 'a:2' } });

        expect(kit().list()).toHaveLength(2);
    });

    test('the folder never resolves to a detached instance', () => {
        kit().ensureDetached({ name: 'img', meta: {} });

        expect(kit().current({ cwd: main.root }).isMain).toBe(true);
    });

    test('the env variable can resolve to a detached instance', () => {
        kit().ensureDetached({ name: 'img', meta: {} });

        expect(kit({ env: { [ENV_VAR]: 'img' } }).current({ cwd: main.root }).name).toBe('img');
    });

    test('a detached name cannot reuse a worktree instance', () => {
        kit().ensure({ cwd: worktree('taken') });

        expect(thrownBy(() => kit().ensureDetached({ name: 'taken' }))).toBeInstanceOf(UsageError);
    });

    test('a detached name must be valid', () => {
        expect(thrownBy(() => kit().ensureDetached({ name: 'Bad Name' }))).toBeInstanceOf(
            UsageError
        );
    });

    test('a detached name cannot be the main name', () => {
        expect(thrownBy(() => kit().ensureDetached({ name: 'main' }))).toBeInstanceOf(UsageError);
    });

    test('removing a detached instance frees its slot', () => {
        kit().ensureDetached({ name: 'gone', meta: {} });
        kit().remove('gone');

        expect(kit().ensureDetached({ name: 'next', meta: {} }).slot).toBe(FIRST_WORKTREE_SLOT);
    });
});

describe('the registry file', () => {
    test('is kept where the app says, in the document it was given', () => {
        kit().ensureDetached({ name: 'qa', meta: {} });

        expect(JSON.parse(fs.readFileSync(stateFile(), 'utf8'))).toEqual({
            qa: { slot: FIRST_WORKTREE_SLOT, root: null, meta: {} }
        });
    });

    test('a file that is not valid JSON fails with a hint to fix or delete it', () => {
        fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
        fs.writeFileSync(stateFile(), '{ not json');

        expect(thrownBy(() => kit().list())).toMatchObject({
            message: expect.stringContaining('is not valid JSON'),
            hint: expect.stringContaining('delete it')
        });
    });

    test('the lock is gone once a registration is done', () => {
        kit().ensureDetached({ name: 'qa', meta: {} });

        expect(fs.existsSync(`${stateFile()}${LOCK_SUFFIX}`)).toBe(false);
    });
});

describe('a registry kept by Artemis 0.1', () => {
    /** What 0.1 wrote for `stateFile: data/instances.json`: the same name, the same lock file. */
    const instancesDocument = () =>
        defineStore({ dir: path.join(dir, 'data') }).doc('instances', { fallback: {} });

    const writtenBy01 = { qa: { slot: FIRST_WORKTREE_SLOT, root: null, meta: { image: 'x' } } };

    test('is read unchanged', () => {
        const registryDocument = instancesDocument();

        fs.mkdirSync(path.dirname(registryDocument.file), { recursive: true });
        fs.writeFileSync(registryDocument.file, `${JSON.stringify(writtenBy01, null, 4)}\n`);

        expect(kit({ registry: registryDocument }).get('qa')).toMatchObject({
            name: 'qa',
            slot: FIRST_WORKTREE_SLOT
        });
    });

    test('keeps its lock at <file>.lock, which a 0.1 process holding it is honored for', () => {
        const registryDocument = instancesDocument();
        const lock = path.join(dir, 'data', 'instances.json.lock');

        const { options, pauses } = createFakeLockOptions({
            isProcessAlive: (pid) => pid === HOLDER_PID,
            timeoutMs: KIT_LOCK_TIMEOUT_MS,
            onPause: () => fs.rmSync(lock, { force: true })
        });

        fs.mkdirSync(path.dirname(lock), { recursive: true });
        fs.writeFileSync(lock, `${HOLDER_PID} token-of-0.1`);

        kit({
            registry: defineStore({ dir: path.dirname(registryDocument.file), ...options }).doc(
                'instances',
                { fallback: {} }
            )
        }).ensureDetached({ name: 'waited' });

        expect(pauses.length).toBeGreaterThan(0);
    });
});

describe('two registrations at once', () => {
    test('a registration that waited for the lock does not overwrite the one made while it waited', () => {
        const lock = `${stateFile()}${LOCK_SUFFIX}`;

        const { options } = createFakeLockOptions({
            isProcessAlive: (pid) => pid === HOLDER_PID,
            timeoutMs: KIT_LOCK_TIMEOUT_MS,
            // The other process finishes its registration, then releases the lock.
            onPause: () => {
                fs.writeFileSync(
                    stateFile(),
                    JSON.stringify({ first: { slot: FIRST_WORKTREE_SLOT, root: null } })
                );

                fs.rmSync(lock, { force: true });
            }
        });

        fs.mkdirSync(path.dirname(lock), { recursive: true });
        fs.writeFileSync(lock, String(HOLDER_PID));

        kit({ registry: registry(options) }).ensureDetached({ name: 'second' });

        expect(
            kit()
                .list()
                .filter((instance) => !instance.isMain)
                .map((instance) => [instance.name, instance.slot])
        ).toEqual([
            ['first', FIRST_WORKTREE_SLOT],
            ['second', FIRST_WORKTREE_SLOT + 1]
        ]);
    });

    test('two registrations in a row never share a slot', () => {
        const first = kit().ensureDetached({ name: 'first' });
        const second = kit().ensureDetached({ name: 'second' });

        expect(first.slot).not.toBe(second.slot);
    });
});

describe('names that look like members of an object', () => {
    test('can be registered like any other name, with real ports', () => {
        expect(kit().ensureDetached({ name: 'constructor' })).toMatchObject({
            name: 'constructor',
            slot: FIRST_WORKTREE_SLOT,
            ports: portsAt(FIRST_WORKTREE_SLOT)
        });
    });

    test('can be read back and removed', () => {
        kit().ensureDetached({ name: 'constructor' });
        kit().remove('constructor');

        expect(
            kit()
                .list()
                .map((instance) => instance.name)
        ).toEqual(['main']);
    });

    test('are the no-instance error when nothing was registered under them', () => {
        expect(thrownBy(() => kit().remove('constructor'))).toMatchObject({
            message: 'There is no instance named "constructor".'
        });
    });

    test('are not found by ensure outside a checkout when nothing was registered under them', () => {
        expect(thrownBy(() => kit().ensure({ cwd: dir, name: 'constructor' }))).toBeInstanceOf(
            UsageError
        );
    });
});

describe('defineWorktrees: the port plan', () => {
    test('bases that meet in two slots below the limit are a TypeError that names both keys', () => {
        expect(
            thrownBy(() => kit({ ports: { elasticsearch: 9200, elasticsearchPerf: 9600 } }))
        ).toMatchObject({
            name: 'TypeError',
            message: expect.stringMatching(/elasticsearch \(9200\) and elasticsearchPerf \(9600\)/)
        });
    });

    test('the same bases pass once they are not a multiple of the step apart', () => {
        expect(() =>
            kit({ ports: { elasticsearch: 9200, elasticsearchPerf: 9650 } })
        ).not.toThrow();
    });

    test('a pair far apart passes with the default limit and is refused with a bigger one', () => {
        expect(thrownBy(() => kit({ ports: { a: 9200, b: 4200 }, maxSlots: 51 }))).toBeInstanceOf(
            TypeError
        );
    });

    test('a port below 1024 is a TypeError naming the key, the slot and the port', () => {
        expect(thrownBy(() => kit({ ports: { http: 80 } }))).toMatchObject({
            message: expect.stringMatching(/ports\.http is 80 in slot 0/)
        });
    });

    test('a slotStep of 0 is a TypeError', () => {
        expect(thrownBy(() => kit({ slotStep: 0 }))).toBeInstanceOf(TypeError);
    });

    test('a fractional maxSlots is a TypeError', () => {
        expect(thrownBy(() => kit({ maxSlots: 2.5 }))).toBeInstanceOf(TypeError);
    });

    test('the message names the function', () => {
        expect(thrownBy(() => kit({ slotStep: 0 }))).toMatchObject({
            message: expect.stringMatching(/^defineWorktrees: /)
        });
    });
});

describe('maxSlots', () => {
    const detached = (worktrees: ReturnType<typeof kit>, count: number) =>
        Array.from({ length: count }, (_, index) =>
            worktrees.ensureDetached({ name: `image-${index + 1}` })
        );

    test('with every slot from 1 to maxSlots - 1 registered, the next one is "All 19 slots are taken"', () => {
        const worktrees = kit();

        detached(worktrees, 19);

        expect(thrownBy(() => worktrees.ensureDetached({ name: 'one-more' }))).toMatchObject({
            message: 'All 19 slots are taken',
            hint: expect.stringContaining('maxSlots')
        });
    });

    test('it is a CommandError, so a person sees a hint and not a stack', () => {
        const worktrees = kit({ maxSlots: 2 });

        detached(worktrees, 1);

        expect(thrownBy(() => worktrees.ensureDetached({ name: 'one-more' }))).toBeInstanceOf(
            CommandError
        );
    });

    test('never gives out slot 0, the main checkout', () => {
        expect(kit({ maxSlots: 2 }).ensureDetached({ name: 'image-1' }).slot).toBe(
            FIRST_WORKTREE_SLOT
        );
    });

    test('a worktree is refused the same way', () => {
        const worktrees = kit({ maxSlots: 2 });

        worktrees.ensureDetached({ name: 'image-1' });

        expect(thrownBy(() => worktrees.ensure({ root: worktree('feat-a') }))).toMatchObject({
            message: 'All 1 slots are taken'
        });
    });

    test('a registry that already holds a slot past the limit still lists it', () => {
        const shared = registry();

        shared.write({ far: { slot: 40, root: null } });

        expect(
            kit({ registry: shared, maxSlots: 20 })
                .list()
                .map((instance) => instance.name)
        ).toEqual(['main', 'far']);
    });

    test('an instance already registered keeps its slot and is not refused, even when the registry is full', () => {
        const worktrees = kit({ maxSlots: 2 });
        const first = worktrees.ensureDetached({ name: 'image-1' });

        expect(worktrees.ensureDetached({ name: 'image-1' }).slot).toBe(first.slot);
    });
});
