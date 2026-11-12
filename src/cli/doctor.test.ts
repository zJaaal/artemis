import { describe, expect, test } from 'vitest';

import { ARTEMIS_PACKAGE } from '../constants.js';
import type { DoctorCheck, DoctorFacts, DoctorCheckId } from '../models.js';
import { doctorFailure, runDoctor } from './doctor.js';

const running = { version: '1.4.0', root: '/usr/lib/node_modules/@zjaaal/artemis' };

/** A healthy project: every check ok. Each test breaks one thing. */
const healthy = (): DoctorFacts => ({
    running,
    local: undefined,
    project: {
        root: '/work/app',
        manifest: { type: 'module', dependencies: { [ARTEMIS_PACKAGE]: '^1.0.0' } }
    },
    commands: { dir: '/work/app/commands', exists: true, warnings: [] },
    hiddenWords: [],
    state: { dir: '/work/app/state', exists: true, unreadable: [] }
});

const checkOf = (checks: DoctorCheck[], id: DoctorCheckId): DoctorCheck | undefined =>
    checks.find((check) => check.id === id);

describe('runDoctor: a healthy project', () => {
    test('reports every check, in order', () => {
        expect(runDoctor(healthy()).map((check) => check.id)).toEqual([
            'version',
            'range',
            'installed',
            'project',
            'module',
            'commands',
            'words',
            'state'
        ]);
    });

    test('an unreadable running version is named, not printed as undefined', () => {
        const facts = { ...healthy(), running: { ...running, version: undefined } };

        expect(checkOf(runDoctor(facts), 'version')?.message).toBe(
            `art an unknown version (${running.root})`
        );
    });

    test('every check is ok', () => {
        expect(new Set(runDoctor(healthy()).map((check) => check.status))).toEqual(new Set(['ok']));
    });

    test('names the version that runs', () => {
        expect(checkOf(runDoctor(healthy()), 'version')?.message).toMatch(/1\.4\.0/);
    });
});

describe('runDoctor: with no project', () => {
    const none: DoctorFacts = {
        running,
        local: undefined,
        project: undefined,
        commands: undefined,
        hiddenWords: [],
        state: undefined
    };

    test('reports only version, installed and project', () => {
        expect(runDoctor(none).map((check) => check.id)).toEqual([
            'version',
            'installed',
            'project'
        ]);
    });

    test('the project check fails, with a fix', () => {
        expect(checkOf(runDoctor(none), 'project')).toMatchObject({
            status: 'fail',
            fix: expect.stringContaining('art init')
        });
    });

    test('installed is ok when there is no copy', () => {
        expect(checkOf(runDoctor(none), 'installed')?.status).toBe('ok');
    });
});

describe('runDoctor: range and installed', () => {
    test('range warns when the running version is not what the project wants', () => {
        const facts = healthy();

        facts.project = {
            root: '/work/app',
            manifest: { type: 'module', dependencies: { [ARTEMIS_PACKAGE]: '^2.0.0' } }
        };

        expect(checkOf(runDoctor(facts), 'range')).toMatchObject({ status: 'warn' });
    });

    test('installed warns when the project installs another copy', () => {
        const facts = {
            ...healthy(),
            local: { version: '1.1.0', root: '/work/app/node_modules/x' }
        };

        expect(checkOf(runDoctor(facts), 'installed')).toMatchObject({ status: 'warn' });
    });
});

describe('runDoctor: module', () => {
    test('warns when package.json does not say "type": "module", with a fix', () => {
        const facts = healthy();

        facts.project = { root: '/work/app', manifest: {} };

        expect(checkOf(runDoctor(facts), 'module')).toMatchObject({
            status: 'warn',
            fix: expect.stringContaining('"type": "module"')
        });
    });
});

describe('runDoctor: commands', () => {
    test('fails when the folder is not there', () => {
        const facts = {
            ...healthy(),
            commands: { dir: '/work/app/commands', exists: false, warnings: [] }
        };

        expect(checkOf(runDoctor(facts), 'commands')?.status).toBe('fail');
    });

    test('fails when a file did not load, and lists it', () => {
        const facts = {
            ...healthy(),
            commands: {
                dir: '/work/app/commands',
                exists: true,
                warnings: ['broken.js failed to load and was skipped: boom']
            }
        };

        expect(checkOf(runDoctor(facts), 'commands')).toMatchObject({
            status: 'fail',
            message: expect.stringContaining('broken.js')
        });
    });

    test('fails for an alias that is already taken', () => {
        const facts = {
            ...healthy(),
            commands: {
                dir: '/work/app/commands',
                exists: true,
                warnings: ['alias "m" of "math" is already taken; ignored']
            }
        };

        expect(checkOf(runDoctor(facts), 'commands')?.status).toBe('fail');
    });

    test('fails with the message of a bad "artemis" key', () => {
        const facts = {
            ...healthy(),
            commands: {
                dir: '',
                exists: false,
                warnings: [],
                problem: '"artemis" must be an object'
            }
        };

        expect(checkOf(runDoctor(facts), 'commands')).toMatchObject({
            status: 'fail',
            message: '"artemis" must be an object'
        });
    });
});

describe('runDoctor: words', () => {
    test('warns for each word a command hides, with the rename as the fix', () => {
        const facts = { ...healthy(), hiddenWords: [{ word: 'doctor', by: 'file' as const }] };

        expect(checkOf(runDoctor(facts), 'words')).toMatchObject({
            status: 'warn',
            message: expect.stringContaining('"doctor"'),
            fix: expect.stringContaining('Rename /work/app/commands/doctor.js')
        });
    });
});

describe('runDoctor: words, where the commands live', () => {
    test('names the commands folder of the project in the fix', () => {
        const facts = {
            ...healthy(),
            hiddenWords: [{ word: 'doctor', by: 'file' as const }],
            commands: { dir: '/work/app/tools/commands', exists: true, warnings: [] }
        };

        expect(checkOf(runDoctor(facts), 'words')?.fix).toContain(
            '/work/app/tools/commands/doctor.js'
        );
    });
});

describe('runDoctor: words hidden by a folder or an alias', () => {
    test('a folder is renamed as a folder, not as a .js file', () => {
        const facts = { ...healthy(), hiddenWords: [{ word: 'state', by: 'folder' as const }] };

        expect(checkOf(runDoctor(facts), 'words')?.fix).toContain('Rename the folder');
    });

    test('an alias is removed from the command it belongs to', () => {
        const facts = {
            ...healthy(),
            hiddenWords: [{ word: 'doctor', by: 'alias' as const, target: 'check' }]
        };

        expect(checkOf(runDoctor(facts), 'words')?.fix).toContain(
            'Remove "doctor" from the aliases of "check"'
        );
    });
});

describe('runDoctor: state', () => {
    test('is ok when there is no state folder yet', () => {
        const facts = {
            ...healthy(),
            state: { dir: '/work/app/state', exists: false, unreadable: [] }
        };

        expect(checkOf(runDoctor(facts), 'state')?.status).toBe('ok');
    });

    test('warns for a document that cannot be read, with the reset as the fix', () => {
        const facts = {
            ...healthy(),
            state: {
                dir: '/work/app/state',
                exists: true,
                unreadable: [{ name: 'steps', error: 'steps.json is not valid JSON' }]
            }
        };

        expect(checkOf(runDoctor(facts), 'state')).toMatchObject({
            status: 'warn',
            fix: 'art state steps --reset'
        });
    });

    test('warns, with a fix, when the state folder cannot be listed', () => {
        const facts = {
            ...healthy(),
            state: { dir: '', exists: false, unreadable: [], problem: 'stateDir must be a string' }
        };

        expect(checkOf(runDoctor(facts), 'state')?.status).toBe('warn');
    });
});

describe('doctorFailure', () => {
    const ok: DoctorCheck = { id: 'version', status: 'ok', message: 'fine' };
    const warn: DoctorCheck = { id: 'module', status: 'warn', message: 'meh', fix: 'do x' };

    const fail = (fix: string): DoctorCheck => ({
        id: 'project',
        status: 'fail',
        message: 'bad',
        fix
    });

    test('is undefined when nothing fails, warnings allowed', () => {
        expect(doctorFailure([ok, warn])).toBeUndefined();
    });

    test('says "1 check failed" for one', () => {
        expect(doctorFailure([ok, fail('fix a')])?.error).toBe('1 check failed');
    });

    test('says "N checks failed" for more', () => {
        expect(doctorFailure([fail('fix a'), fail('fix b')])?.error).toBe('2 checks failed');
    });

    test('the hint is the first failing fix', () => {
        expect(doctorFailure([warn, fail('fix a'), fail('fix b')])?.hint).toBe('fix a');
    });

    test('keeps every check, passing ones too', () => {
        expect(doctorFailure([ok, warn, fail('fix a')])?.checks).toHaveLength(3);
    });
});
