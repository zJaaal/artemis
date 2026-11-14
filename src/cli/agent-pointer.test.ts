import { describe, expect, test } from 'vitest';

import { INIT_POINTER_MAX_BYTES, POINTER_MARKER } from '../constants.js';
import type { PointerInput, TextFile } from '../models.js';
import { appendedText, gitignoreLine, planPointer, pointerText } from './agent-pointer.js';

const file = (name: string, text: string, real = `/work/${name}`): TextFile => ({
    path: `/work/${name}`,
    real,
    text
});

const base = (overrides: Partial<PointerInput> = {}): PointerInput => ({
    dir: '/work',
    bin: 'art',
    agents: undefined,
    claude: undefined,
    gitignore: undefined,
    gitignoreLine: undefined,
    ...overrides
});

const pointer = pointerText('art');

describe('pointerText', () => {
    test('names the bin, the brief listing, --json, --dry-run before --yes and --authoring', () => {
        expect(pointer).toBe(
            [
                '## Commands',
                '',
                "This project's commands run through `art`. Start with `npx art help --json --brief`, call one with `--json`, and pass `--dry-run` before `--yes` on a destructive one. To write a new one: `npx art help --authoring`."
            ].join('\n')
        );
    });

    test('is under INIT_POINTER_MAX_BYTES with the default bin', () => {
        expect(Buffer.byteLength(pointer)).toBeLessThan(INIT_POINTER_MAX_BYTES);
    });

    test('uses the bin of the project, and a long one is not cut', () => {
        expect(pointerText('a-very-long-tool-name-of-a-project')).toContain(
            'npx a-very-long-tool-name-of-a-project help --authoring'
        );
    });

    test('contains the marker that says it is already there', () => {
        expect(pointer).toContain(POINTER_MARKER);
    });
});

describe('appendedText', () => {
    test('after a file that ends with a newline, one blank line then the text', () => {
        expect(appendedText('# Title\n', 'x')).toBe('\nx\n');
    });

    test('after a file with no final newline, a newline first, then the blank line', () => {
        expect(appendedText('# Title', 'x')).toBe('\n\nx\n');
    });

    test('in an empty file there is just the text', () => {
        expect(appendedText('', 'x')).toBe('x\n');
    });

    test('uses CRLF when the first line of the file ends with it', () => {
        expect(appendedText('# Title\r\nbody\r\n', 'a\nb')).toBe('\r\na\r\nb\r\n');
    });

    test('does not use CRLF when only a later line has it', () => {
        expect(appendedText('# Title\nbody\r\n', 'a')).toBe('\na\n');
    });
});

describe('gitignoreLine', () => {
    test('is the audit files under the state folder, relative to the project', () => {
        expect(gitignoreLine('/work', '/work/state')).toBe('/state/audit*.jsonl');
    });

    test('a nested state folder keeps its path, with forward slashes', () => {
        expect(gitignoreLine('/work', '/work/data/state')).toBe('/data/state/audit*.jsonl');
    });

    test('the project folder itself is the root of the line', () => {
        expect(gitignoreLine('/work', '/work')).toBe('/audit*.jsonl');
    });

    test('a state folder outside the project has no line', () => {
        expect(gitignoreLine('/work', '/elsewhere/state')).toBeUndefined();
    });

    test('a state folder whose name only starts with two dots is inside the project', () => {
        expect(gitignoreLine('/work', '/work/..state')).toBe('/..state/audit*.jsonl');
    });

    test('a sibling folder that only starts like the project is outside it', () => {
        expect(gitignoreLine('/work/app', '/work/app-state')).toBeUndefined();
    });
});

describe('planPointer: AGENTS.md and CLAUDE.md', () => {
    test('neither file: AGENTS.md is created with a title and the pointer', () => {
        expect(planPointer(base())).toEqual([
            {
                kind: 'file',
                mode: 'create',
                path: '/work/AGENTS.md',
                text: `# AGENTS.md\n\n${pointer}\n`
            }
        ]);
    });

    test('AGENTS.md only: the pointer is appended', () => {
        expect(planPointer(base({ agents: file('AGENTS.md', '# Mine\n') }))).toEqual([
            { kind: 'file', mode: 'append', path: '/work/AGENTS.md', text: `\n${pointer}\n` }
        ]);
    });

    test('AGENTS.md that already has the pointer is left alone', () => {
        expect(planPointer(base({ agents: file('AGENTS.md', `x\n${pointer}\n`) }))).toEqual([]);
    });

    test('AGENTS.md that mentions help --json --brief in its own words is left alone', () => {
        expect(
            planPointer(base({ agents: file('AGENTS.md', 'run `mytool help --json --brief`\n') }))
        ).toEqual([]);
    });

    test('CLAUDE.md without the import: the pointer is appended to it, and AGENTS.md is not created', () => {
        expect(planPointer(base({ claude: file('CLAUDE.md', '# Claude\n') }))).toEqual([
            { kind: 'file', mode: 'append', path: '/work/CLAUDE.md', text: `\n${pointer}\n` }
        ]);
    });

    test('CLAUDE.md that imports AGENTS.md is left alone', () => {
        const claude = file('CLAUDE.md', '@AGENTS.md\n');
        const agents = file('AGENTS.md', 'x\n', '/work/real-agents');

        expect(planPointer(base({ claude, agents })).map((step) => step.path)).toEqual([
            '/work/AGENTS.md'
        ]);
    });

    test('the import must start a line: a mention in prose is not one', () => {
        const claude = file('CLAUDE.md', 'see @AGENTS.md later\n');

        expect(planPointer(base({ claude })).map((step) => step.path)).toEqual(['/work/CLAUDE.md']);
    });

    test('CLAUDE.md importing a missing AGENTS.md: AGENTS.md is created, CLAUDE.md untouched', () => {
        const steps = planPointer(base({ claude: file('CLAUDE.md', '@AGENTS.md\n') }));

        expect(steps).toEqual([
            {
                kind: 'file',
                mode: 'create',
                path: '/work/AGENTS.md',
                text: `# AGENTS.md\n\n${pointer}\n`
            }
        ]);
    });

    test('both files, no import: the pointer goes into both', () => {
        const steps = planPointer(
            base({ agents: file('AGENTS.md', 'a\n'), claude: file('CLAUDE.md', 'c\n') })
        );

        expect(steps.map((step) => step.path)).toEqual(['/work/AGENTS.md', '/work/CLAUDE.md']);
    });

    test('CLAUDE.md that already has the pointer is left alone, whatever AGENTS.md says', () => {
        const steps = planPointer(
            base({ agents: file('AGENTS.md', 'a\n'), claude: file('CLAUDE.md', `${pointer}\n`) })
        );

        expect(steps.map((step) => step.path)).toEqual(['/work/AGENTS.md']);
    });

    test('a link: two names for one real file are written once', () => {
        const real = '/work/AGENTS.md';

        const steps = planPointer(
            base({
                agents: file('AGENTS.md', 'a\n', real),
                claude: file('CLAUDE.md', 'a\n', real)
            })
        );

        expect(steps).toHaveLength(1);
    });

    test('it never rewrites a line: a file only gets text appended', () => {
        const steps = planPointer(base({ agents: file('AGENTS.md', 'one\ntwo') }));

        expect(steps[0]).toMatchObject({ mode: 'append', text: `\n\n${pointer}\n` });
    });

    test('a CRLF file gets CRLF', () => {
        const [step] = planPointer(base({ agents: file('AGENTS.md', '# Mine\r\n') }));

        expect(step).toMatchObject({ text: `\r\n${pointer.split('\n').join('\r\n')}\r\n` });
    });
});

describe('planPointer: .gitignore', () => {
    const line = '/state/audit*.jsonl';

    test('is created with the line when it is missing', () => {
        const steps = planPointer(
            base({ agents: file('AGENTS.md', `${pointer}\n`), gitignoreLine: line })
        );

        expect(steps).toEqual([
            { kind: 'file', mode: 'create', path: '/work/.gitignore', text: `${line}\n` }
        ]);
    });

    test('gets the line appended when the file exists without it', () => {
        const steps = planPointer(
            base({
                agents: file('AGENTS.md', `${pointer}\n`),
                gitignore: file('.gitignore', 'node_modules\n'),
                gitignoreLine: line
            })
        );

        expect(steps).toEqual([
            { kind: 'file', mode: 'append', path: '/work/.gitignore', text: `\n${line}\n` }
        ]);
    });

    test('is left alone when a line equal to it is there', () => {
        const steps = planPointer(
            base({
                agents: file('AGENTS.md', `${pointer}\n`),
                gitignore: file('.gitignore', `node_modules\n${line}\n`),
                gitignoreLine: line
            })
        );

        expect(steps).toEqual([]);
    });

    test('a line with a trailing CR or spaces still counts as there', () => {
        const steps = planPointer(
            base({
                agents: file('AGENTS.md', `${pointer}\n`),
                gitignore: file('.gitignore', `${line}  \r\n`),
                gitignoreLine: line
            })
        );

        expect(steps).toEqual([]);
    });

    test('a line that only contains it is not it', () => {
        const steps = planPointer(
            base({
                agents: file('AGENTS.md', `${pointer}\n`),
                gitignore: file('.gitignore', `# ${line}\n`),
                gitignoreLine: line
            })
        );

        expect(steps).toHaveLength(1);
    });

    test('nothing is written when the state folder is outside the project', () => {
        const steps = planPointer(base({ agents: file('AGENTS.md', `${pointer}\n`) }));

        expect(steps).toEqual([]);
    });
});
