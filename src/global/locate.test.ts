import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { isFolder } from '../edges/files.js';
import { makeProject } from '../test/project.js';
import { createTempFolders } from '../test/temp.js';
import { COMMANDS_FOLDER, ENV_COMMANDS, ENV_HOME, PROJECT_FOLDER } from './constants.js';
import { locateCommands, userCommandsDir } from './locate.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

/** A fresh machine: an empty home folder, and an empty place for projects. */
const machine = () => ({
    home: folders.make('artemis-home-'),
    work: folders.make('artemis-work-')
});

const locate = (cwd: string, home: string, env: NodeJS.ProcessEnv = {}) =>
    locateCommands({ cwd, home, env, isFolder });

describe('locateCommands: a project', () => {
    test('finds .artemis/commands in the current folder', () => {
        const { home, work } = machine();
        const commands = makeProject(work, 'project');

        expect(locate(work, home)).toEqual({
            kind: 'found',
            location: { dir: commands, source: 'project' }
        });
    });

    test('finds it from a folder deep inside the project', () => {
        const { home, work } = machine();
        const commands = makeProject(work, 'project');
        const deep = path.join(work, 'src', 'deep');

        fs.mkdirSync(deep, { recursive: true });

        expect(locate(deep, home)).toMatchObject({ location: { dir: commands } });
    });

    test('the nearest project wins when projects are nested', () => {
        const { home, work } = machine();
        const inner = path.join(work, 'packages', 'inner');

        makeProject(work, 'outer');
        const innerCommands = makeProject(inner, 'inner');

        expect(locate(inner, home)).toMatchObject({ location: { dir: innerCommands } });
    });

    test('sibling projects each find their own commands', () => {
        const { home, work } = machine();
        const a = makeProject(path.join(work, 'a'), 'a');
        const b = makeProject(path.join(work, 'b'), 'b');

        expect([locate(path.join(work, 'a'), home), locate(path.join(work, 'b'), home)]).toEqual([
            { kind: 'found', location: { dir: a, source: 'project' } },
            { kind: 'found', location: { dir: b, source: 'project' } }
        ]);
    });

    test('a file named commands is not a commands folder', () => {
        const { home, work } = machine();

        fs.mkdirSync(path.join(work, PROJECT_FOLDER), { recursive: true });
        fs.writeFileSync(path.join(work, PROJECT_FOLDER, COMMANDS_FOLDER), '');

        expect(locate(work, home).kind).toBe('missing');
    });
});

describe('locateCommands: the user folder', () => {
    test('is used outside any project', () => {
        const { home, work } = machine();
        const commands = makeProject(home, 'user');

        expect(locate(work, home)).toEqual({
            kind: 'found',
            location: { dir: commands, source: 'user' }
        });
    });

    test('loses to a project', () => {
        const { home, work } = machine();
        const projectCommands = makeProject(work, 'project');

        makeProject(home, 'user');

        expect(locate(work, home)).toMatchObject({ location: { dir: projectCommands } });
    });

    test('is reported as the user folder when it is found by walking up from under home', () => {
        const { home } = machine();
        const commands = makeProject(home, 'user');
        const below = path.join(home, 'code', 'thing');

        fs.mkdirSync(below, { recursive: true });

        expect(locate(below, home)).toMatchObject({ location: { dir: commands, source: 'user' } });
    });

    test('moves with ARTEMIS_HOME', () => {
        const { home, work } = machine();
        const elsewhere = folders.make('artemis-elsewhere-');
        const commands = makeProject(elsewhere, 'moved');

        expect(locate(work, home, { [ENV_HOME]: path.join(elsewhere, PROJECT_FOLDER) })).toEqual({
            kind: 'found',
            location: { dir: commands, source: 'user' }
        });
    });

    test('is ~/.artemis/commands by default', () => {
        expect(userCommandsDir('/home/ana', {})).toBe(
            path.join('/home/ana', PROJECT_FOLDER, COMMANDS_FOLDER)
        );
    });
});

describe('locateCommands: the env override', () => {
    test('wins over a project', () => {
        const { home, work } = machine();
        const pinned = folders.make('artemis-pinned-');

        makeProject(work, 'project');

        expect(locate(work, home, { [ENV_COMMANDS]: pinned })).toEqual({
            kind: 'found',
            location: { dir: pinned, source: 'env' }
        });
    });

    test('is resolved against the current folder when it is relative', () => {
        const { home, work } = machine();

        expect(locate(work, home, { [ENV_COMMANDS]: 'mine' })).toMatchObject({
            location: { dir: path.join(work, 'mine'), source: 'env' }
        });
    });

    test('is used even when the folder does not exist, so the mistake shows', () => {
        const { home, work } = machine();

        expect(locate(work, home, { [ENV_COMMANDS]: '/nowhere/commands' }).kind).toBe('found');
    });
});

describe('locateCommands: nothing found', () => {
    test('says so, listing every place it looked, the user folder last', () => {
        const { home, work } = machine();
        const result = locate(work, home);

        expect(result.kind === 'missing' && result.searched.at(-1)).toBe(
            path.join(home, PROJECT_FOLDER, COMMANDS_FOLDER)
        );
    });

    test('lists the current folder first', () => {
        const { home, work } = machine();
        const result = locate(work, home);

        expect(result.kind === 'missing' && result.searched[0]).toBe(
            path.join(work, PROJECT_FOLDER, COMMANDS_FOLDER)
        );
    });
});
