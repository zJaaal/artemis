import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { makeProject } from '../test/project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import type { Envelope } from '../test/models.js';
import { ENV_COMMANDS, PROJECT_FOLDER } from './constants.js';
import { main } from './main.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const machine = () => ({
    home: folders.make('artemis-home-'),
    work: folders.make('artemis-work-')
});

/** Runs the global command as if typed in `cwd` on a machine whose home is `home`. */
const artemis = async (argv: string[], cwd: string, home: string, env: NodeJS.ProcessEnv = {}) => {
    const stdout = createSink();
    const stderr = createSink();

    const code = await main(argv, {
        cwd,
        home,
        env,
        stdout,
        stderr,
        interactive: false,
        color: false
    });

    return { code, out: stdout.text, err: stderr.text };
};

const greeting = (out: string): unknown => (JSON.parse(out) as Envelope).result;

describe('the global command: which commands it runs', () => {
    test('runs the commands of the project it is run in', async () => {
        const { home, work } = machine();

        makeProject(work, 'project');

        expect(greeting((await artemis(['hello', '--json'], work, home)).out)).toEqual({
            greeting: 'project'
        });
    });

    test('runs them from a folder deep inside the project', async () => {
        const { home, work } = machine();

        makeProject(work, 'project');

        const result = await artemis(['hello', '--json'], path.join(work, 'src', 'deep'), home);

        expect(greeting(result.out)).toEqual({ greeting: 'project' });
    });

    test('two projects on one machine never see each other', async () => {
        const { home, work } = machine();
        const a = path.join(work, 'a');
        const b = path.join(work, 'b');

        makeProject(a, 'project a');
        makeProject(b, 'project b');

        const results = [
            greeting((await artemis(['hello', '--json'], a, home)).out),
            greeting((await artemis(['hello', '--json'], b, home)).out)
        ];

        expect(results).toEqual([{ greeting: 'project a' }, { greeting: 'project b' }]);
    });

    test('the nearest project wins when projects are nested', async () => {
        const { home, work } = machine();
        const inner = path.join(work, 'packages', 'inner');

        makeProject(work, 'outer');
        makeProject(inner, 'inner');

        expect(greeting((await artemis(['hello', '--json'], inner, home)).out)).toEqual({
            greeting: 'inner'
        });
    });

    test('outside any project it runs the user-level commands', async () => {
        const { home, work } = machine();

        makeProject(home, 'user');

        expect(greeting((await artemis(['hello', '--json'], work, home)).out)).toEqual({
            greeting: 'user'
        });
    });

    test('ARTEMIS_COMMANDS pins the folder, whatever the current folder is', async () => {
        const { home, work } = machine();
        const pinned = makeProject(folders.make('artemis-pinned-'), 'pinned');

        makeProject(work, 'project');

        const result = await artemis(['hello', '--json'], work, home, { [ENV_COMMANDS]: pinned });

        expect(greeting(result.out)).toEqual({ greeting: 'pinned' });
    });
});

describe('the global command: output', () => {
    test('names itself artemis in help and usage lines', async () => {
        const { home, work } = machine();

        makeProject(work, 'project');

        expect((await artemis(['help'], work, home)).out).toContain('artemis <topic> <command>');
    });

    test('help --json lists the commands of the project', async () => {
        const { home, work } = machine();

        makeProject(work, 'project');

        const manifest = greeting((await artemis(['help', '--json'], work, home)).out) as {
            bin: string;
            commands: { id: string }[];
        };

        expect([manifest.bin, manifest.commands.map((command) => command.id)]).toEqual([
            'artemis',
            ['hello']
        ]);
    });

    test('exits with the code of the command line it ran', async () => {
        const { home, work } = machine();

        makeProject(work, 'project');

        expect((await artemis(['nope'], work, home)).code).toBe(EXIT_CODE.USAGE);
    });
});

describe('the global command: no commands folder', () => {
    test('fails as a command failure', async () => {
        const { home, work } = machine();

        expect((await artemis(['hello'], work, home)).code).toBe(EXIT_CODE.FAILED);
    });

    test('says where it looked and how to fix it', async () => {
        const { home, work } = machine();
        const { err } = await artemis(['hello'], work, home);

        expect(err).toContain(`Create ${PROJECT_FOLDER}/commands in your project`);
        expect(err).toContain(path.join(work, PROJECT_FOLDER, 'commands'));
    });

    test('under --json it is the usual failure object on stdout', async () => {
        const { home, work } = machine();
        const result = await artemis(['hello', '--json'], work, home);

        expect(JSON.parse(result.out)).toMatchObject({
            ok: false,
            command: null,
            hint: expect.stringContaining('ARTEMIS_COMMANDS')
        });
    });
});
