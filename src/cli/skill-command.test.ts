import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { makeProject } from '../test/project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import type { Envelope } from '../test/models.js';
import { cli } from './index.js';

// The fake stands in for `@topcli/prompts`, which needs a real terminal: it answers the confirm.
const fake = vi.hoisted(() => ({ calls: [] as string[], answer: false }));

vi.mock('@topcli/prompts', () => {
    const unused = () => Promise.reject(new Error('skill only asks yes or no'));

    return {
        multiselect: unused,
        question: unused,
        select: unused,
        confirm: (message: string) => {
            fake.calls.push(message);

            return Promise.resolve(fake.answer);
        }
    };
});

const folders = createTempFolders();

beforeEach(() => {
    fake.calls = [];
    fake.answer = false;
});

afterEach(() => folders.cleanUp());

const art = async (argv: string[], cwd: string, interactive = false) => {
    const stdout = createSink();
    const stderr = createSink();
    const code = await cli({ argv, cwd, stdout, stderr, env: {}, interactive, color: false });

    return { code, out: stdout.text, err: stderr.text };
};

const resultOf = (out: string) => (JSON.parse(out) as Envelope).result as Record<string, string>;

const newProject = (manifest: Record<string, unknown> = {}): string => {
    const root = folders.make('artemis-skill-');

    makeProject(root, { greeting: 'project', manifest });

    return root;
};

describe('art skill: printing', () => {
    test('prints a SKILL.md built from the project commands', async () => {
        const { out } = await art(['skill'], newProject({ description: 'Our scripts' }));

        expect(out).toMatch(
            /^---\nname: art\ndescription: "Use the art CLI of project[^"]*Our scripts"\n---/
        );
    });

    test('names the help --agents line', async () => {
        expect((await art(['skill'], newProject())).out).toContain('`art help --agents`');
    });

    test('under --json the result is { markdown }', async () => {
        const { out } = await art(['skill', '--json'], newProject());

        expect(resultOf(out).markdown).toMatch(/^---\nname: art/);
    });

    test('exits 0', async () => {
        expect((await art(['skill'], newProject())).code).toBe(EXIT_CODE.OK);
    });

    test('uses the bin the project configured', async () => {
        const root = newProject({ artemis: { bin: 'mytool' } });

        expect((await art(['skill'], root)).out).toContain('name: mytool');
    });

    test('with no project it is the usual no-project error, exit 1', async () => {
        expect((await art(['skill'], folders.make('artemis-skill-'))).code).toBe(EXIT_CODE.FAILED);
    });
});

describe('art skill --write', () => {
    test('writes the file, creating the folders that are missing', async () => {
        const root = newProject();
        const target = path.join('.claude', 'skills', 'art', 'SKILL.md');

        await art(['skill', '--write', target], root);

        expect(fs.readFileSync(path.join(root, target), 'utf8')).toMatch(/^---\nname: art/);
    });

    test('under --json the result is { file } with the absolute path', async () => {
        const root = newProject();
        const { out } = await art(['skill', '--write', 'SKILL.md', '--json'], root);

        expect(resultOf(out).file).toBe(path.join(root, 'SKILL.md'));
    });

    test('an existing file is left alone when nobody can answer and there is no --yes', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'SKILL.md'), 'mine\n');

        const result = await art(['skill', '--write', 'SKILL.md'], root);

        expect([result.code, fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')]).toEqual([
            EXIT_CODE.FAILED,
            'mine\n'
        ]);
    });

    test('and the hint says to pass --yes to overwrite it', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'SKILL.md'), 'mine\n');

        const { out } = await art(['skill', '--write', 'SKILL.md', '--json'], root);

        expect(JSON.parse(out).hint).toMatch(/Pass --yes to overwrite/);
    });

    test('with --yes it overwrites', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'SKILL.md'), 'mine\n');
        await art(['skill', '--write', 'SKILL.md', '--yes'], root);

        expect(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')).toMatch(/^---/);
    });

    test('in a terminal it asks, and yes overwrites', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'SKILL.md'), 'mine\n');
        fake.answer = true;
        await art(['skill', '--write', 'SKILL.md'], root, true);

        expect(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')).toMatch(/^---/);
    });

    test('in a terminal "no" leaves it, says so and exits 0', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'SKILL.md'), 'mine\n');

        const result = await art(['skill', '--write', 'SKILL.md'], root, true);

        expect([
            result.code,
            result.out,
            fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')
        ]).toEqual([
            EXIT_CODE.OK,
            expect.stringMatching(/Not written: .* is unchanged\./),
            'mine\n'
        ]);
    });

    test('a file that is not there yet is written without a question', async () => {
        const root = newProject();

        await art(['skill', '--write', 'SKILL.md'], root, true);

        expect(fake.calls).toEqual([]);
    });
});

describe('art skill: the word', () => {
    test('--help prints its usage and works with no project', async () => {
        const result = await art(['skill', '--help'], folders.make('artemis-skill-'));

        expect(result.out).toMatch(/Usage: skill/);
    });

    test('--dry-run is a usage error', async () => {
        expect((await art(['skill', '--dry-run'], newProject())).code).toBe(EXIT_CODE.USAGE);
    });

    test('--log is a usage error', async () => {
        expect((await art(['skill', '--log', 'x.log'], newProject())).code).toBe(EXIT_CODE.USAGE);
    });

    test('a command called skill hides behind the word, with a warning', async () => {
        const root = newProject();

        fs.writeFileSync(
            path.join(root, 'commands', 'skill.js'),
            "import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'mine', run: () => 1 });\n"
        );

        expect((await art(['skill'], root)).err).toMatch(/"skill"/);
    });

    test('--quiet hides that warning', async () => {
        const root = newProject();

        fs.writeFileSync(
            path.join(root, 'commands', 'skill.js'),
            "import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'mine', run: () => 1 });\n"
        );

        expect((await art(['skill', '--quiet'], root)).err).toBe('');
    });

    test('help --json lists it under builtins', async () => {
        const { out } = await art(['help', '--json'], newProject());

        expect(
            JSON.parse(out).result.builtins.map((builtin: { id: string }) => builtin.id)
        ).toContain('skill');
    });
});

describe('art skill --write: a path that cannot be a file', () => {
    test('a folder is a failure with a hint, not a stack trace', async () => {
        const root = newProject();

        fs.mkdirSync(path.join(root, 'out'));

        const run = await art(['skill', '--write', 'out', '--yes', '--json'], root);

        expect(JSON.parse(run.out)).toMatchObject({ ok: false, hint: expect.any(String) });
    });

    test('a parent that is a file is a failure too', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'blocker'), '');

        const run = await art(['skill', '--write', 'blocker/SKILL.md', '--yes', '--json'], root);

        expect(run.code).toBe(EXIT_CODE.FAILED);
    });
});
