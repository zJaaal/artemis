import { describe, expect, test } from 'vitest';

import { SKILL_MAX_EXAMPLES } from '../constants.js';
import type { Manifest, ManifestCommand } from '../models.js';
import { buildSkill } from './skill.js';

const command = (overrides: Partial<ManifestCommand> & { id: string }): ManifestCommand => ({
    description: `${overrides.id} does a thing`,
    usage: `art ${overrides.id} [flags]`,
    aliases: [],
    args: [],
    flags: [],
    examples: [],
    destructive: false,
    dryRun: false,
    ...overrides
});

const manifestOf = (commands: ManifestCommand[]): Manifest => ({
    bin: 'art',
    topics: [],
    commands,
    globalFlags: []
});

const none = { name: undefined, description: undefined };

describe('buildSkill: the frontmatter', () => {
    test('starts with the bin as the name', () => {
        expect(buildSkill(manifestOf([]), none)).toMatch(/^---\nname: art\n/);
    });

    test('names the package and carries its description', () => {
        const skill = buildSkill(manifestOf([]), { name: 'scripts', description: 'Our scripts.' });

        expect(skill).toContain(
            'description: "Use the art CLI of scripts instead of doing these tasks by hand. Our scripts."'
        );
    });

    test('without a package name the sentence names only the CLI', () => {
        expect(buildSkill(manifestOf([]), none)).toContain(
            'description: "Use the art CLI instead of doing these tasks by hand."'
        );
    });

    test('a description with a colon, quotes and a newline stays a single valid YAML string', () => {
        const skill = buildSkill(manifestOf([]), {
            name: 'x',
            description: 'Tools: "quoted"\nand a second line'
        });

        const line = skill.split('\n').find((row) => row.startsWith('description: ')) ?? '';

        expect(JSON.parse(line.slice('description: '.length))).toContain(
            'Tools: "quoted" and a second line'
        );
    });

    test('the frontmatter is closed before the first heading', () => {
        expect(buildSkill(manifestOf([]), none)).toMatch(/^---\n[^]*?\n---\n\n# art\n/);
    });
});

describe('buildSkill: the fixed part', () => {
    test('says how to find commands and get one in full', () => {
        expect(buildSkill(manifestOf([]), none)).toContain(
            '`art help --json --brief`. One command in full: `art help <command> --json`.'
        );
    });

    test('points at help --agents for adding a command, which works with a global art', () => {
        expect(buildSkill(manifestOf([]), none)).toContain(
            'To add a command: `art help --agents`.'
        );
    });

    test('names the exit codes', () => {
        expect(buildSkill(manifestOf([]), none)).toContain(
            '0 ok, 1 the command failed, 2 the command line was wrong'
        );
    });

    test('uses the bin of the project, not art', () => {
        const manifest = { ...manifestOf([]), bin: 'mytool' };

        expect(buildSkill(manifest, none)).toContain('`mytool help --json --brief`');
    });
});

describe('buildSkill: the destructive section', () => {
    test('is left out when no command is destructive', () => {
        expect(buildSkill(manifestOf([command({ id: 'hello' })]), none)).not.toMatch(
            /## Destructive/
        );
    });

    test('lists a destructive command with its description', () => {
        const prune = command({
            id: 'dotcms prune',
            description: "Delete an instance's data",
            destructive: true
        });

        expect(buildSkill(manifestOf([prune]), none)).toContain(
            "- `art dotcms prune`: Delete an instance's data"
        );
    });

    test('marks the ones that support --dry-run', () => {
        const prune = command({ id: 'prune', destructive: true, dryRun: true });

        expect(buildSkill(manifestOf([prune]), none)).toMatch(/- `art prune`: .*\(`--dry-run`\)/);
    });

    test('does not mark one that does not', () => {
        const prune = command({ id: 'prune', destructive: true });

        expect(buildSkill(manifestOf([prune]), none)).not.toMatch(/--dry-run`\)/);
    });
});

describe('buildSkill: the examples', () => {
    test('are left out when no command has any', () => {
        expect(buildSkill(manifestOf([command({ id: 'hello' })]), none)).not.toMatch(/## Examples/);
    });

    test('come in manifest order, each with the bin in front and nothing appended', () => {
        const commands = [
            command({ id: 'a', examples: ['a one', 'a two'] }),
            command({ id: 'b', examples: ['b one'] })
        ];

        const section = buildSkill(manifestOf(commands), none).split('## Examples\n\n')[1];

        expect(section).toBe('- `art a one`\n- `art a two`\n- `art b one`\n');
    });

    test('are capped at SKILL_MAX_EXAMPLES', () => {
        const examples = Array.from({ length: SKILL_MAX_EXAMPLES + 5 }, (_, index) => `x ${index}`);
        const skill = buildSkill(manifestOf([command({ id: 'x', examples })]), none);

        expect(skill.match(/^- `art x \d+`$/gm)).toHaveLength(SKILL_MAX_EXAMPLES);
    });
});

describe('buildSkill: what it never says', () => {
    const skill = buildSkill(
        manifestOf([
            command({
                id: 'greet',
                usage: 'art greet <name> [flags]',
                args: [
                    { name: 'name', description: '', required: true, default: null, choices: null }
                ],
                flags: [
                    {
                        name: 'shout',
                        type: 'boolean',
                        short: 's',
                        multiple: false,
                        description: 'Loud',
                        default: null,
                        choices: null
                    }
                ],
                examples: ['greet ana']
            })
        ]),
        none
    );

    test('has no usage line', () => {
        expect(skill).not.toContain('art greet <name>');
    });

    test('has no argument name', () => {
        expect(skill).not.toMatch(/<name>/);
    });

    test('has no command flag', () => {
        expect(skill).not.toContain('--shout');
    });
});
