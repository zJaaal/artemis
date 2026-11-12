import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { readRunningPackage } from '../edges/package-info.js';
import { art, envelope } from '../test/art.js';

const AGENTS = fs.readFileSync(path.join(readRunningPackage().root, 'AGENTS.md'), 'utf8');

describe('help --agents', () => {
    test('prints the AGENTS.md of the running copy, as it is', async () => {
        expect((await art(['help', '--agents'])).out).toBe(`${AGENTS.trimEnd()}\n`);
    });

    test('under --json it is { file, markdown }', async () => {
        const result = envelope(await art(['help', '--agents', '--json'])).result;

        expect(result).toEqual({
            file: path.join(readRunningPackage().root, 'AGENTS.md'),
            markdown: AGENTS
        });
    });

    test('exits 0', async () => {
        expect((await art(['help', '--agents'])).code).toBe(EXIT_CODE.OK);
    });

    test('accepts --quiet', async () => {
        expect((await art(['help', '--agents', '--quiet'])).code).toBe(EXIT_CODE.OK);
    });

    test('takes no topic or command', async () => {
        expect((await art(['help', 'hello', '--agents'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('takes no --brief', async () => {
        expect((await art(['help', '--agents', '--brief'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('anywhere but help it is an unknown flag', async () => {
        expect((await art(['hello', '--agents'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('works on a published tool, which has no builtins', async () => {
        expect((await art(['help', '--agents'], { builtins: undefined })).code).toBe(EXIT_CODE.OK);
    });
});
