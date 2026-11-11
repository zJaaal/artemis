import { describe, expect, test } from 'vitest';

import { PACKAGE_NAME } from './constants.js';
import { resolve } from './resolve-hook.js';

const PROJECT_FILE_URL = 'file:///work/project/.artemis/commands/hello.js';

/** What the next hook in the chain was asked: it records, and answers like Node would. */
const recordingNext = () => {
    const calls: { specifier: string; parentURL: string | undefined }[] = [];

    return {
        calls,
        next: (specifier: string, context?: { parentURL?: string | undefined }) => {
            calls.push({ specifier, parentURL: context?.parentURL });

            return Promise.resolve({ url: `file:///resolved/${specifier}`, shortCircuit: true });
        }
    };
};

const resolveFrom = async (specifier: string) => {
    const { calls, next } = recordingNext();

    await resolve(
        specifier,
        { parentURL: PROJECT_FILE_URL, conditions: [], importAttributes: {} },
        next
    );

    return calls[0];
};

describe('the package resolve hook', () => {
    test('resolves the package name from inside the running package, not from the project', async () => {
        const call = await resolveFrom(PACKAGE_NAME);

        expect(call?.parentURL).toMatch(/\/global\/resolve-hook\.(ts|js)$/);
    });

    test('does the same for the subpaths of the package', async () => {
        const call = await resolveFrom(`${PACKAGE_NAME}/worktrees`);

        expect(call?.parentURL).toMatch(/\/global\/resolve-hook\.(ts|js)$/);
    });

    test('leaves every other import to resolve from where it is written', async () => {
        const call = await resolveFrom('prompts');

        expect(call?.parentURL).toBe(PROJECT_FILE_URL);
    });

    test('does not capture a package that only starts with the same letters', async () => {
        const call = await resolveFrom(`${PACKAGE_NAME}-other`);

        expect(call?.parentURL).toBe(PROJECT_FILE_URL);
    });
});
