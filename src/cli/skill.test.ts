import { describe, expect, test } from 'vitest';

import {
    SKILL_AUTHORING_MAX_BYTES,
    SKILL_MAX_DESTRUCTIVE,
    SKILL_MAX_EXAMPLES
} from '../constants.js';
import type { Manifest, ManifestCommand } from '../models.js';
import { buildSkill } from './skill.js';

const command = (overrides: Partial<ManifestCommand> & { id: string }): ManifestCommand => ({
    description: `${overrides.id} does a thing`,
    usage: `art ${overrides.id} [flags]`,
    args: [],
    flags: [],
    ...overrides
});

const manifestOf = (commands: ManifestCommand[]): Manifest => ({
    bin: 'art',
    topics: [],
    commands,
    globalFlags: []
});

const none = { name: undefined, description: undefined };

/** The skill of a manifest, for a project whose commands are in `commands/`. */
const build = (
    manifest: Manifest,
    pkg: Parameters<typeof buildSkill>[1],
    commandsDir = 'commands'
) => buildSkill(manifest, pkg, commandsDir);

describe('buildSkill: the frontmatter', () => {
    test('starts with the bin as the name', () => {
        expect(build(manifestOf([]), none)).toMatch(/^---\nname: art\n/);
    });

    test('names the package and carries its description', () => {
        const skill = build(manifestOf([]), { name: 'scripts', description: 'Our scripts.' });

        expect(skill).toContain(
            'description: "Use the art CLI of scripts instead of doing these tasks by hand. Our scripts."'
        );
    });

    test('without a package name the sentence names only the CLI', () => {
        expect(build(manifestOf([]), none)).toContain(
            'description: "Use the art CLI instead of doing these tasks by hand."'
        );
    });

    test('a description with a colon, quotes and a newline stays a single valid YAML string', () => {
        const skill = build(manifestOf([]), {
            name: 'x',
            description: 'Tools: "quoted"\nand a second line'
        });

        const line = skill.split('\n').find((row) => row.startsWith('description: ')) ?? '';

        expect(JSON.parse(line.slice('description: '.length))).toContain(
            'Tools: "quoted" and a second line'
        );
    });

    test('the frontmatter is closed before the first heading', () => {
        expect(build(manifestOf([]), none)).toMatch(/^---\n[^]*?\n---\n\n# art\n/);
    });
});

describe('buildSkill: the fixed part', () => {
    test('says how to find commands and get one in full', () => {
        expect(build(manifestOf([]), none)).toContain(
            '`art help --json --brief`. One command in full: `art help <command> --json`.'
        );
    });

    test('names the exit codes', () => {
        expect(build(manifestOf([]), none)).toContain(
            '0 ok, 1 the command failed, 2 the command line was wrong'
        );
    });

    test('uses the bin of the project, not art', () => {
        const manifest = { ...manifestOf([]), bin: 'mytool' };

        expect(build(manifest, none)).toContain('`mytool help --json --brief`');
    });

    test('says to run the bin through npx in the project, or bare when installed globally', () => {
        const manifest = { ...manifestOf([]), bin: 'mytool' };

        expect(build(manifest, none)).toContain(
            'Run `mytool` as `npx mytool` in this project, or as `mytool` when it is installed globally.'
        );
    });
});

describe('buildSkill: the destructive section', () => {
    test('is left out when no command is destructive', () => {
        expect(build(manifestOf([command({ id: 'hello' })]), none)).not.toMatch(/## Destructive/);
    });

    test('lists a destructive command with its description', () => {
        const prune = command({
            id: 'dotcms prune',
            description: "Delete an instance's data",
            destructive: true
        });

        expect(build(manifestOf([prune]), none)).toContain(
            "- `art dotcms prune`: Delete an instance's data"
        );
    });

    test('marks the ones that support --dry-run', () => {
        const prune = command({ id: 'prune', destructive: true, dryRun: true });

        expect(build(manifestOf([prune]), none)).toMatch(/- `art prune`: .*\(`--dry-run`\)/);
    });

    test('does not mark one that does not', () => {
        const prune = command({ id: 'prune', destructive: true });

        expect(build(manifestOf([prune]), none)).not.toMatch(/--dry-run`\)/);
    });
});

describe('buildSkill: the examples', () => {
    test('are left out when no command has any', () => {
        expect(build(manifestOf([command({ id: 'hello' })]), none)).not.toMatch(/## Examples/);
    });

    test('come in manifest order, each with the bin in front and nothing appended', () => {
        const commands = [
            command({ id: 'a', examples: ['a one', 'a two'] }),
            command({ id: 'b', examples: ['b one'] })
        ];

        const section = build(manifestOf(commands), none).split('## Examples\n\n')[1];

        expect(section).toBe('- `art a one`\n- `art a two`\n- `art b one`\n');
    });

    test('are capped at SKILL_MAX_EXAMPLES', () => {
        const examples = Array.from({ length: SKILL_MAX_EXAMPLES + 5 }, (_, index) => `x ${index}`);
        const skill = build(manifestOf([command({ id: 'x', examples })]), none);

        expect(skill.match(/^- `art x \d+`$/gm)).toHaveLength(SKILL_MAX_EXAMPLES);
    });
});

describe('buildSkill: what it never says', () => {
    const skill = build(
        manifestOf([
            command({
                id: 'greet',
                usage: 'art greet <person> [flags]',
                args: [{ name: 'person', description: '', required: true }],
                flags: [
                    {
                        name: 'shout',
                        type: 'boolean',
                        short: 's',
                        description: 'Loud'
                    }
                ],
                examples: ['greet ana']
            })
        ]),
        none
    );

    test('has no usage line', () => {
        expect(skill).not.toContain('art greet <person>');
    });

    test('has no argument name', () => {
        expect(skill).not.toMatch(/<person>/);
    });

    test('has no command flag', () => {
        expect(skill).not.toContain('--shout');
    });
});

describe('buildSkill: the Writing a command section', () => {
    const skill = (bin = 'art', commandsDir = 'commands') =>
        build({ ...manifestOf([]), bin }, none, commandsDir);

    const sectionOf = (text: string): string =>
        text.slice(text.indexOf('## Writing a command')).split('\n\n## ')[0] ?? '';

    test('has its own heading', () => {
        expect(skill()).toContain('\n\n## Writing a command\n\n');
    });

    test('says to write a command when the same job is done twice', () => {
        expect(skill()).toContain('**Write a command when you do the same job twice.**');
    });

    test('names the commands folder of the project', () => {
        expect(skill('art', 'tools/commands')).toContain('`tools/commands/<topic>/<name>.js`');
    });

    test('points at help --authoring with the bin of the project', () => {
        expect(skill('mytool')).toContain('`mytool help --authoring` has the rules');
    });

    test('no longer points at help --agents for writing a command', () => {
        expect(skill()).not.toContain('To add a command');
    });

    test('is at most SKILL_AUTHORING_MAX_BYTES with the default bin and commands folder', () => {
        expect(Buffer.byteLength(sectionOf(skill()))).toBeLessThanOrEqual(
            SKILL_AUTHORING_MAX_BYTES
        );
    });

    test('names the rules an author needs', () => {
        const section = sectionOf(skill());

        expect(
            ['destructive: true', 'dryRun: true', 'ctx.plan', 'ctx.exec', 'CommandError'].filter(
                (rule) => !section.includes(rule)
            )
        ).toEqual([]);
    });
});

describe('buildSkill: the destructive list has a ceiling', () => {
    const destructives = (count: number) =>
        Array.from({ length: count }, (_, index) =>
            command({ id: `drop${index}`, destructive: true })
        );

    test('lists at most SKILL_MAX_DESTRUCTIVE commands', () => {
        const skill = build(manifestOf(destructives(SKILL_MAX_DESTRUCTIVE + 5)), none);

        expect(skill.match(/^- `art drop\d+`/gm)).toHaveLength(SKILL_MAX_DESTRUCTIVE);
    });

    test('says how many more there are, and where to see them', () => {
        const skill = build(manifestOf(destructives(SKILL_MAX_DESTRUCTIVE + 5)), none);

        expect(skill).toContain('- and 5 more: `art help --json --brief`');
    });

    test('says nothing about more when they all fit', () => {
        expect(build(manifestOf(destructives(SKILL_MAX_DESTRUCTIVE)), none)).not.toContain(
            ' more:'
        );
    });
});
