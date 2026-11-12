import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import type { DoctorCheck } from '../models.js';
import { makeProject } from '../test/project.js';
import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import type { Envelope } from '../test/models.js';
import { cli } from './index.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const art = async (argv: string[], cwd: string) => {
    const stdout = createSink();
    const stderr = createSink();

    const code = await cli({
        argv,
        cwd,
        stdout,
        stderr,
        env: {},
        interactive: false,
        color: false
    });

    return { code, out: stdout.text, err: stderr.text };
};

const checksOf = (out: string): DoctorCheck[] => {
    const parsed = JSON.parse(out) as Envelope & { result?: { checks: DoctorCheck[] } };

    return parsed.result?.checks ?? (parsed.checks as DoctorCheck[]);
};

const statusOf = (out: string, id: string): string | undefined =>
    checksOf(out).find((check) => check.id === id)?.status;

const newProject = (
    manifest: Record<string, unknown> = { type: 'module', artemis: {} }
): string => {
    const root = folders.make('artemis-doctor-');

    makeProject(root, { greeting: 'project', manifest });

    return root;
};

describe('art doctor: a healthy project', () => {
    test('exits 0', async () => {
        expect((await art(['doctor'], newProject())).code).toBe(EXIT_CODE.OK);
    });

    test('under --json it is one ok envelope with the version and every check', async () => {
        const { out } = await art(['doctor', '--json'], newProject());

        expect(JSON.parse(out)).toMatchObject({
            ok: true,
            command: 'doctor',
            result: { checks: expect.any(Array) }
        });
    });

    test('text mode prints one line per check', async () => {
        const { out } = await art(['doctor'], newProject());

        expect(out.trim().split('\n')).toHaveLength(8);
    });
});

describe('art doctor: with only warnings', () => {
    test('a package.json without "type": "module" warns and still exits 0', async () => {
        const root = newProject({});
        const result = await art(['doctor', '--json'], root);

        expect([result.code, statusOf(result.out, 'module')]).toEqual([EXIT_CODE.OK, 'warn']);
    });

    test('a state document that cannot be read warns, naming the reset', async () => {
        const root = newProject();

        fs.mkdirSync(path.join(root, 'state'));
        fs.writeFileSync(path.join(root, 'state', 'steps.json'), '{ not json');

        const { out } = await art(['doctor', '--json'], root);

        expect(checksOf(out).find((check) => check.id === 'state')?.fix).toBe(
            'art state steps --reset'
        );
    });

    test('a command called doctor is reported as hidden by the words check', async () => {
        const root = newProject();

        fs.writeFileSync(
            path.join(root, 'commands', 'doctor.js'),
            "import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'mine', run: () => 1 });\n"
        );

        expect(statusOf((await art(['doctor', '--json'], root)).out, 'words')).toBe('warn');
    });
});

describe('art doctor: a command that hides a built-in word through an alias or a folder', () => {
    const command = (aliases: string): string =>
        `import { defineCommand } from '@zjaaal/artemis';\nexport default defineCommand({ description: 'mine', aliases: ${aliases}, run: () => 1 });\n`;

    test('an alias called like a word is reported, naming the command it belongs to', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'commands', 'check.js'), command("['doctor']"));

        const { out } = await art(['doctor', '--json'], root);

        expect(checksOf(out).find((check) => check.id === 'words')?.message).toContain(
            '"doctor" (an alias of "check")'
        );
    });

    test('a topic folder called like a word is reported with a fix that names the folder', async () => {
        const root = newProject();

        fs.mkdirSync(path.join(root, 'commands', 'state'));
        fs.writeFileSync(path.join(root, 'commands', 'state', 'x.js'), command('[]'));

        const { out } = await art(['doctor', '--json'], root);

        expect(checksOf(out).find((check) => check.id === 'words')?.fix).toContain(
            'Rename the folder'
        );
    });
});

describe('art doctor: with a failure', () => {
    test('a commands folder that is missing fails, exit 1', async () => {
        const root = newProject();

        fs.rmSync(path.join(root, 'commands'), { recursive: true });

        expect((await art(['doctor'], root)).code).toBe(EXIT_CODE.FAILED);
    });

    test('the failing envelope has ok: false, the error, the first fix as hint and every check', async () => {
        const root = newProject();

        fs.rmSync(path.join(root, 'commands'), { recursive: true });

        const failure = JSON.parse((await art(['doctor', '--json'], root)).out);

        expect(failure).toMatchObject({
            ok: false,
            command: 'doctor',
            error: '1 check failed',
            hint: expect.stringContaining('commandsDir'),
            checks: expect.any(Array)
        });
    });

    test('a file that does not load fails the commands check', async () => {
        const root = newProject();

        fs.writeFileSync(path.join(root, 'commands', 'broken.js'), 'export default (');

        expect(statusOf((await art(['doctor', '--json'], root)).out, 'commands')).toBe('fail');
    });

    test('in text mode the checks print, then the error and the hint on stderr', async () => {
        const root = newProject();

        fs.rmSync(path.join(root, 'commands'), { recursive: true });

        const result = await art(['doctor'], root);

        expect(result.err).toMatch(/Error: 1 check failed[\s\S]*Hint:/);
    });
});

describe('art doctor: with no project', () => {
    test('the project check fails and the run exits 1', async () => {
        const result = await art(['doctor', '--json'], folders.make('artemis-doctor-'));

        expect([result.code, statusOf(result.out, 'project')]).toEqual([EXIT_CODE.FAILED, 'fail']);
    });

    test('only version, installed and project are reported', async () => {
        const result = await art(['doctor', '--json'], folders.make('artemis-doctor-'));

        expect(checksOf(result.out).map((check) => check.id)).toEqual([
            'version',
            'installed',
            'project'
        ]);
    });
});

describe('art doctor: the every-run warning', () => {
    test('never prints on doctor, which reports the same facts as checks', async () => {
        const root = newProject({
            type: 'module',
            devDependencies: { '@zjaaal/artemis': '^99.0.0' }
        });

        const result = await art(['doctor'], root);

        expect(result.err).not.toMatch(/Run art doctor/);
    });

    test('and the range check says so', async () => {
        const root = newProject({
            type: 'module',
            devDependencies: { '@zjaaal/artemis': '^99.0.0' }
        });

        expect(statusOf((await art(['doctor', '--json'], root)).out, 'range')).toBe('warn');
    });
});

describe('art doctor: its flags', () => {
    test('--help prints its usage and exits 0 with no project needed', async () => {
        const result = await art(['doctor', '--help'], folders.make('artemis-doctor-'));

        expect([result.code, result.out]).toEqual([
            EXIT_CODE.OK,
            expect.stringContaining('Usage: doctor')
        ]);
    });

    test('--quiet is accepted', async () => {
        expect((await art(['doctor', '--quiet'], newProject())).code).toBe(EXIT_CODE.OK);
    });

    test('--dry-run is a usage error', async () => {
        expect((await art(['doctor', '--dry-run'], newProject())).code).toBe(EXIT_CODE.USAGE);
    });

    test('--log is a usage error', async () => {
        expect((await art(['doctor', '--log', 'x.log'], newProject())).code).toBe(EXIT_CODE.USAGE);
    });

    test('an argument is a usage error', async () => {
        expect((await art(['doctor', 'now'], newProject())).code).toBe(EXIT_CODE.USAGE);
    });

    test('help --json lists it under builtins', async () => {
        const root = newProject();
        const { out } = await art(['help', '--json'], root);

        expect(
            JSON.parse(out).result.builtins.map((builtin: { id: string }) => builtin.id)
        ).toContain('doctor');
    });

    test('doctor --help --json is its manifest entry', async () => {
        const { out } = await art(['doctor', '--help', '--json'], folders.make('artemis-doctor-'));

        expect(JSON.parse(out)).toMatchObject({
            ok: true,
            command: 'doctor',
            result: { id: 'doctor' }
        });
    });
});
