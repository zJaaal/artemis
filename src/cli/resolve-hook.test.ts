import { describe, expect, test } from 'vitest';

import { ERROR_CODE, PACKAGE_NAME } from '../constants.js';
import { resolve } from './resolve-hook.js';

const PROJECT_FILE_URL = 'file:///work/project/commands/hello.js';
const RESOLVED = { url: 'file:///resolved/somewhere.js', shortCircuit: true } as const;

const context = { parentURL: PROJECT_FILE_URL, conditions: [], importAttributes: {} };

/**
 * A stand-in for the rest of Node's resolution: it answers for the specifiers it was told about
 * and says "module not found" for the rest, like Node does. It records what it was asked.
 */
const nodeResolution = (known: string[]) => {
    const asked: { specifier: string; parentURL: string | undefined }[] = [];

    return {
        asked,
        next: (specifier: string, nextContext?: { parentURL?: string | undefined }) => {
            asked.push({ specifier, parentURL: nextContext?.parentURL });

            if (
                known.includes(specifier) ||
                nextContext?.parentURL?.includes('/cli/resolve-hook')
            ) {
                return Promise.resolve(RESOLVED);
            }

            return Promise.reject(
                Object.assign(new Error(`Cannot find package '${specifier}'`), {
                    code: ERROR_CODE.MODULE_NOT_FOUND
                })
            );
        }
    };
};

describe('the package resolve hook', () => {
    test('a copy the project installed itself wins: normal resolution is used as it is', async () => {
        const { asked, next } = nodeResolution([PACKAGE_NAME]);

        await resolve(PACKAGE_NAME, context, next);

        expect(asked).toEqual([{ specifier: PACKAGE_NAME, parentURL: PROJECT_FILE_URL }]);
    });

    test('with no local copy the package name is resolved from the running copy', async () => {
        const { asked, next } = nodeResolution([]);

        await resolve(PACKAGE_NAME, context, next);

        expect(asked[1]?.parentURL).toMatch(/\/cli\/resolve-hook\.(ts|js)$/);
    });

    test('the same goes for the subpaths of the package', async () => {
        const { asked, next } = nodeResolution([]);

        await resolve(`${PACKAGE_NAME}/worktrees`, context, next);

        expect(asked[1]?.parentURL).toMatch(/\/cli\/resolve-hook\.(ts|js)$/);
    });

    test('another package that is missing is still an error', async () => {
        const { next } = nodeResolution([]);

        await expect(resolve('left-pad', context, next)).rejects.toMatchObject({
            code: ERROR_CODE.MODULE_NOT_FOUND
        });
    });

    test('a package that only starts with the same letters is not ours', async () => {
        const { next } = nodeResolution([]);

        await expect(resolve(`${PACKAGE_NAME}-other`, context, next)).rejects.toMatchObject({
            code: ERROR_CODE.MODULE_NOT_FOUND
        });
    });

    test('an error that is not "module not found" is not swallowed', async () => {
        const failure = Object.assign(new Error('not exported'), {
            code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
        });

        await expect(
            resolve(`${PACKAGE_NAME}/secret`, context, () => Promise.reject(failure))
        ).rejects.toBe(failure);
    });
});
