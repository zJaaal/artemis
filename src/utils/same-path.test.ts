import { describe, expect, test } from 'vitest';

import { samePath } from './same-path.js';

describe('samePath: Windows', () => {
    test('paths that differ only in case are one folder', () => {
        expect(
            samePath('C:\\Users\\RunnerAdmin\\app', 'c:\\users\\runneradmin\\APP', 'win32')
        ).toBe(true);
    });

    test('forward and back slashes are one folder', () => {
        expect(samePath('C:/Users/me/app', 'C:\\Users\\me\\app', 'win32')).toBe(true);
    });

    test('different folders are different', () => {
        expect(samePath('C:\\Users\\me\\app', 'C:\\Users\\me\\app2', 'win32')).toBe(false);
    });
});

describe('samePath: every other platform', () => {
    test.each(['linux', 'darwin'] as const)('on %s case counts', (platform) => {
        expect(samePath('/work/App', '/work/app', platform)).toBe(false);
    });

    test('the same path is the same', () => {
        expect(samePath('/work/app', '/work/app', 'linux')).toBe(true);
    });
});
