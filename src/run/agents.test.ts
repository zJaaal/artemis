import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
    AGENTS_ADDING_HEADING,
    AGENTS_CALLING_HEADING,
    AGENTS_DOC_MAX_BYTES,
    AGENTS_RUNNING_HEADING,
    EXIT_CODE
} from '../constants.js';
import { markdownSection } from '../help/markdown.js';
import { readRunningPackage } from '../edges/package-info.js';
import { art, envelope } from '../test/art.js';

const AGENTS = fs.readFileSync(path.join(readRunningPackage().root, 'AGENTS.md'), 'utf8');

const section = (heading: string): string => markdownSection(AGENTS, heading) ?? '';

describe('the shipped AGENTS.md', () => {
    test.each([AGENTS_CALLING_HEADING, AGENTS_ADDING_HEADING, AGENTS_RUNNING_HEADING])(
        'has the section %s',
        (heading) => {
            expect(markdownSection(AGENTS, heading)).toBeDefined();
        }
    );
});

describe('help --agents', () => {
    const CALLING = section(AGENTS_CALLING_HEADING);
    const POINTER = 'To write a command or set up a project: art help --authoring';

    test('prints the calling section and one line naming the authoring part', async () => {
        expect((await art(['help', '--agents'])).out).toBe(`${CALLING}\n\n${POINTER}\n`);
    });

    test('prints nothing of the writing or the setup sections', async () => {
        const { out } = await art(['help', '--agents']);

        expect(out).not.toContain(AGENTS_ADDING_HEADING);
        expect(out).not.toContain(AGENTS_RUNNING_HEADING);
    });

    test('stays under AGENTS_DOC_MAX_BYTES', async () => {
        expect(Buffer.byteLength((await art(['help', '--agents'])).out)).toBeLessThan(
            AGENTS_DOC_MAX_BYTES
        );
    });

    test('under --json it is { file, markdown }, the markdown being what is printed', async () => {
        const result = envelope(await art(['help', '--agents', '--json'])).result;

        expect(result).toEqual({
            file: path.join(readRunningPackage().root, 'AGENTS.md'),
            markdown: `${CALLING}\n\n${POINTER}`
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

    test('takes no --authoring', async () => {
        expect((await art(['help', '--agents', '--authoring'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('takes no --search', async () => {
        expect((await art(['help', '--agents', '--search', 'x'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('anywhere but help it is an unknown flag', async () => {
        expect((await art(['hello', '--agents'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('works on a published tool, which has no builtins', async () => {
        expect((await art(['help', '--agents'], { builtins: undefined })).code).toBe(EXIT_CODE.OK);
    });
});

describe('help --authoring', () => {
    test('prints the adding and the running sections, in that order', async () => {
        expect((await art(['help', '--authoring'])).out).toBe(
            `${section(AGENTS_ADDING_HEADING)}\n\n${section(AGENTS_RUNNING_HEADING)}\n`
        );
    });

    test('prints nothing of the calling section', async () => {
        expect((await art(['help', '--authoring'])).out).not.toContain(AGENTS_CALLING_HEADING);
    });

    test('under --json it is { file, markdown }', async () => {
        const result = envelope(await art(['help', '--authoring', '--json'])).result;

        expect(result).toEqual({
            file: path.join(readRunningPackage().root, 'AGENTS.md'),
            markdown: `${section(AGENTS_ADDING_HEADING)}\n\n${section(AGENTS_RUNNING_HEADING)}`
        });
    });

    test('takes no topic or command', async () => {
        expect((await art(['help', 'hello', '--authoring'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('takes no --brief', async () => {
        expect((await art(['help', '--authoring', '--brief'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('takes no --search', async () => {
        expect((await art(['help', '--authoring', '--search', 'x'])).code).toBe(EXIT_CODE.USAGE);
    });

    test('works on a published tool, which has no builtins', async () => {
        expect((await art(['help', '--authoring'], { builtins: undefined })).code).toBe(
            EXIT_CODE.OK
        );
    });
});
