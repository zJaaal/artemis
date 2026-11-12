import { describe, expect, test } from 'vitest';

import { ARTEMIS_PACKAGE } from '../constants.js';
import type { InstallFacts } from '../models.js';
import { installedCheck, rangeCheck, rangeOf, versionWarningLine } from './install-checks.js';

const running = { version: '1.4.0', root: '/usr/lib/node_modules/@zjaaal/artemis' };

const facts = (overrides: Partial<InstallFacts> = {}): InstallFacts => ({
    running,
    range: undefined,
    local: undefined,
    ...overrides
});

describe('rangeOf', () => {
    test('reads the range from dependencies', () => {
        expect(rangeOf({ dependencies: { [ARTEMIS_PACKAGE]: '^1.0.0' } })).toBe('^1.0.0');
    });

    test('reads it from devDependencies when dependencies has none', () => {
        expect(rangeOf({ devDependencies: { [ARTEMIS_PACKAGE]: '~1.2.0' } })).toBe('~1.2.0');
    });

    test('is undefined when the project does not depend on Artemis', () => {
        expect(rangeOf({ dependencies: { other: '1.0.0' } })).toBeUndefined();
    });

    test('is undefined for a manifest with no dependency fields', () => {
        expect(rangeOf({ name: 'x' })).toBeUndefined();
    });
});

describe('rangeCheck', () => {
    test('is ok when the project does not depend on Artemis', () => {
        expect(rangeCheck(facts())).toMatchObject({ id: 'range', status: 'ok' });
    });

    test('is ok when the running version satisfies the range', () => {
        expect(rangeCheck(facts({ range: '^1.0.0' })).status).toBe('ok');
    });

    test('warns when it does not, with a fix', () => {
        expect(rangeCheck(facts({ range: '^2.0.0' }))).toMatchObject({
            status: 'warn',
            fix: expect.stringContaining('npx art')
        });
    });

    test('says "not checked" for a form it does not understand, and is ok', () => {
        expect(rangeCheck(facts({ range: 'workspace:*' }))).toMatchObject({
            status: 'ok',
            message: 'not checked: workspace:*'
        });
    });

    test('says "not checked" for a running prerelease, and is ok', () => {
        const prerelease = { ...running, version: '1.4.0-beta.1' };

        expect(rangeCheck(facts({ running: prerelease, range: '^1.0.0' }))).toMatchObject({
            status: 'ok',
            message: 'not checked: running a prerelease'
        });
    });
});

describe('installedCheck', () => {
    test('is ok, saying where it runs from, when the project has no copy', () => {
        expect(installedCheck(facts()).message).toMatch(running.root);
    });

    test('is ok when the copy is the running version', () => {
        const local = { version: running.version, root: '/p/node_modules/@zjaaal/artemis' };

        expect(installedCheck(facts({ local })).status).toBe('ok');
    });

    test('warns when the copy differs, naming both versions', () => {
        const local = { version: '1.1.0', root: '/p/node_modules/@zjaaal/artemis' };

        expect(installedCheck(facts({ local }))).toMatchObject({
            status: 'warn',
            message: expect.stringMatching(/1\.4\.0.*1\.1\.0/)
        });
    });

    test('still warns for a prerelease copy: versions are compared as strings', () => {
        const local = { version: '1.4.0-beta.1', root: '/p/node_modules/@zjaaal/artemis' };

        expect(installedCheck(facts({ local })).status).toBe('warn');
    });
});

describe('versionWarningLine', () => {
    test('is undefined when nothing warns', () => {
        expect(versionWarningLine(facts({ range: '^1.0.0' }))).toBeUndefined();
    });

    test('names the range when only it warns', () => {
        expect(versionWarningLine(facts({ range: '^2.0.0' }))).toBe(
            'art 1.4.0 is running; this project wants ^2.0.0. Run art doctor.'
        );
    });

    test('names the installed copy when only it warns', () => {
        const local = { version: '1.1.0', root: '/p' };

        expect(versionWarningLine(facts({ local }))).toBe(
            'art 1.4.0 is running; this project installs 1.1.0. Run art doctor.'
        );
    });

    test('names both facts in one line when both warn', () => {
        const local = { version: '1.1.0', root: '/p' };

        expect(versionWarningLine(facts({ range: '^2.0.0', local }))).toBe(
            'art 1.4.0 is running; this project wants ^2.0.0 and this project installs 1.1.0. Run art doctor.'
        );
    });
});
