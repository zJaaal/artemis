import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createSink } from '../test/sink.js';
import { createTempFolders } from '../test/temp.js';
import { pointerText } from './agent-pointer.js';
import { cli } from './index.js';
import { initProject } from './init.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const POINTER = pointerText('art');

const newDir = (): string => folders.make('artemis-init-pointer-');

const read = (dir: string, name: string): string => fs.readFileSync(path.join(dir, name), 'utf8');

const write = (dir: string, name: string, text: string): void =>
    fs.writeFileSync(path.join(dir, name), text);

const names = (dir: string, files: string[]): string[] =>
    files.map((file) => path.relative(dir, file)).sort();

describe('init: the agent pointer on the disk', () => {
    test('with neither file, AGENTS.md is created with a title and the pointer', () => {
        const dir = newDir();

        initProject(dir);

        expect(read(dir, 'AGENTS.md')).toBe(`# AGENTS.md\n\n${POINTER}\n`);
    });

    test('with neither file, CLAUDE.md is not created', () => {
        const dir = newDir();

        initProject(dir);

        expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
    });

    test('AGENTS.md only: the pointer is appended after a blank line, the rest untouched', () => {
        const dir = newDir();

        write(dir, 'AGENTS.md', '# Mine\n\nRules.\n');
        initProject(dir);

        expect(read(dir, 'AGENTS.md')).toBe(`# Mine\n\nRules.\n\n${POINTER}\n`);
    });

    test('the file that was appended to is named under changed, not created', () => {
        const dir = newDir();

        write(dir, 'AGENTS.md', '# Mine\n');

        const result = initProject(dir);

        expect([names(dir, result.changed), result.created.map((f) => path.basename(f))]).toEqual([
            ['AGENTS.md'],
            expect.not.arrayContaining(['AGENTS.md'])
        ]);
    });

    test('CLAUDE.md without the import gets the pointer, and AGENTS.md is not created', () => {
        const dir = newDir();

        write(dir, 'CLAUDE.md', '# Claude\n');
        initProject(dir);

        expect([read(dir, 'CLAUDE.md'), fs.existsSync(path.join(dir, 'AGENTS.md'))]).toEqual([
            `# Claude\n\n${POINTER}\n`,
            false
        ]);
    });

    test('CLAUDE.md that imports AGENTS.md is untouched, and AGENTS.md has the pointer', () => {
        const dir = newDir();

        write(dir, 'CLAUDE.md', '@AGENTS.md\n');
        write(dir, 'AGENTS.md', '# Mine\n');
        initProject(dir);

        expect([read(dir, 'CLAUDE.md'), read(dir, 'AGENTS.md')]).toEqual([
            '@AGENTS.md\n',
            `# Mine\n\n${POINTER}\n`
        ]);
    });

    test('CLAUDE.md importing an AGENTS.md that is missing: AGENTS.md is created', () => {
        const dir = newDir();

        write(dir, 'CLAUDE.md', '@AGENTS.md\n');
        initProject(dir);

        expect([read(dir, 'CLAUDE.md'), read(dir, 'AGENTS.md')]).toEqual([
            '@AGENTS.md\n',
            `# AGENTS.md\n\n${POINTER}\n`
        ]);
    });

    test('a CLAUDE.md that is a link to AGENTS.md gets the pointer once', () => {
        const dir = newDir();

        write(dir, 'AGENTS.md', '# Mine\n');
        fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
        initProject(dir);

        expect(read(dir, 'AGENTS.md').split('## Commands')).toHaveLength(2);
    });

    test('a pointer that is already there is left alone', () => {
        const dir = newDir();
        const text = `# Mine\n\n${POINTER}\n`;

        write(dir, 'AGENTS.md', text);
        initProject(dir);

        expect(read(dir, 'AGENTS.md')).toBe(text);
    });

    test('a CRLF file gets CRLF line endings', () => {
        const dir = newDir();

        write(dir, 'AGENTS.md', '# Mine\r\n');
        initProject(dir);

        expect(read(dir, 'AGENTS.md')).toBe(
            `# Mine\r\n\r\n${POINTER.split('\n').join('\r\n')}\r\n`
        );
    });

    test('a file with no final newline gets one before the blank line', () => {
        const dir = newDir();

        write(dir, 'AGENTS.md', '# Mine');
        initProject(dir);

        expect(read(dir, 'AGENTS.md')).toBe(`# Mine\n\n${POINTER}\n`);
    });

    test('the pointer names the bin of the project', () => {
        const dir = newDir();

        write(dir, 'package.json', JSON.stringify({ name: 'app', artemis: { bin: 'mytool' } }));
        initProject(dir);

        expect(read(dir, 'AGENTS.md')).toContain('npx mytool help --json --brief');
    });

    test('running it twice changes nothing the second time', () => {
        const dir = newDir();

        initProject(dir);

        const before = [read(dir, 'AGENTS.md'), read(dir, '.gitignore')];
        const second = initProject(dir);

        expect([
            second.created,
            second.changed,
            [read(dir, 'AGENTS.md'), read(dir, '.gitignore')]
        ]).toEqual([[], [], before]);
    });
});

describe('init: the .gitignore line', () => {
    test('is created with the audit files of the default state folder', () => {
        const dir = newDir();

        initProject(dir);

        expect(read(dir, '.gitignore')).toBe('/state/audit*.jsonl\n');
    });

    test('is appended to a .gitignore that exists', () => {
        const dir = newDir();

        write(dir, '.gitignore', 'node_modules\n');
        initProject(dir);

        expect(read(dir, '.gitignore')).toBe('node_modules\n\n/state/audit*.jsonl\n');
    });

    test('is not repeated when it is there', () => {
        const dir = newDir();

        write(dir, '.gitignore', '/state/audit*.jsonl\n');
        initProject(dir);

        expect(read(dir, '.gitignore')).toBe('/state/audit*.jsonl\n');
    });

    test('follows the stateDir of the project, relative to it', () => {
        const dir = newDir();

        write(
            dir,
            'package.json',
            JSON.stringify({ name: 'app', artemis: { stateDir: 'data/state' } })
        );

        initProject(dir);

        expect(read(dir, '.gitignore')).toBe('/data/state/audit*.jsonl\n');
    });

    test('is not written when the state folder is outside the project', () => {
        const dir = newDir();

        write(
            dir,
            'package.json',
            JSON.stringify({ name: 'app', artemis: { stateDir: '../state' } })
        );

        initProject(dir);

        expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
    });

    test('does not need the folder to be a git repository', () => {
        const dir = newDir();

        initProject(dir);

        expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
        expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(true);
    });
});

describe('art init: what it says', () => {
    const initOutput = async (dir: string, ...flags: string[]) => {
        const stdout = createSink();

        await cli({
            argv: ['init', ...flags],
            cwd: dir,
            stdout,
            stderr: createSink(),
            env: {},
            interactive: false,
            color: false
        });

        return stdout.text;
    };

    test('names the files created', async () => {
        const out = await initOutput(newDir());

        expect(out).toContain('Created');
        expect(out).toContain('AGENTS.md');
    });

    test('names the files it appended to, as changed', async () => {
        const dir = newDir();

        write(dir, 'AGENTS.md', '# Mine\n');

        expect(await initOutput(dir)).toMatch(/Changed .*AGENTS\.md/);
    });

    test('--json has created and changed', async () => {
        const dir = newDir();

        write(dir, 'AGENTS.md', '# Mine\n');

        const result = JSON.parse(await initOutput(dir, '--json')).result;

        expect(result.changed).toEqual([path.join(dir, 'AGENTS.md')]);
    });

    test('a rerun with nothing to do is still "Already a project"', async () => {
        const dir = newDir();

        await initOutput(dir);

        expect(await initOutput(dir)).toContain('Already a project: nothing to create.');
    });
});
