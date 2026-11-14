import { LINE_BREAKS, SKILL_MAX_DESTRUCTIVE, SKILL_MAX_EXAMPLES } from '../constants.js';
import type { BuildSkillFn, Manifest, ManifestCommand } from '../models.js';

// Pure: the SKILL.md. Its content is fixed and short on purpose: it names no usage line, argument or
// flag of any command, and points at `help <command> --json` for those, so it never goes stale.

/**
 * The description line, always a YAML double-quoted string: a JSON string is a valid YAML scalar, so
 * a `:`, a quote or a newline in the package description cannot break the frontmatter.
 */
function descriptionLine(bin: string, { name, description }: Parameters<BuildSkillFn>[1]): string {
    const subject = name === undefined ? `the ${bin} CLI` : `the ${bin} CLI of ${name}`;
    const sentence = `Use ${subject} instead of doing these tasks by hand.`;
    const folded = description?.replace(LINE_BREAKS, ' ').trim();

    return JSON.stringify(folded ? `${sentence} ${folded}` : sentence);
}

/** The nudge to turn a repeated job into a command, and where the rules are. */
const authoringSection = (bin: string, commandsDir: string): string =>
    [
        '## Writing a command',
        '',
        `**Write a command when you do the same job twice.** If you ran the same steps twice in a session, put them in \`${commandsDir}/<topic>/<name>.js\` and call that instead. \`${bin} help --authoring\` has the rules: a one-line \`description\`, \`args\` and \`flags\` with descriptions, \`destructive: true\` for anything that deletes, \`dryRun: true\` with \`ctx.plan\` and \`ctx.dryRun\`, \`ctx.exec\` for child processes, and \`CommandError(message, { hint })\` for a failure the caller can fix. Make the result answer the question you ran it for, not a log.`
    ].join('\n');

const destructiveLine = (bin: string, command: ManifestCommand): string => {
    const dryRun = command.dryRun ? ' (`--dry-run`)' : '';

    return `- \`${bin} ${command.id}\`: ${command.description}${dryRun}`;
};

/** The first examples in manifest order: commands in order, each one's examples in order. */
const exampleLines = (bin: string, commands: readonly ManifestCommand[]): string[] =>
    commands
        .flatMap((command) => command.examples ?? [])
        .slice(0, SKILL_MAX_EXAMPLES)
        .map((example) => `- \`${bin} ${example}\``);

/**
 * The `SKILL.md` of a project: frontmatter, how to find and call commands, the destructive ones
 * (left out when there are none) and a few examples (left out when none has any).
 */
export const buildSkill: BuildSkillFn = (manifest: Manifest, pkg, commandsDir) => {
    const { bin, commands } = manifest;
    const destructive = commands.filter((command) => command.destructive);
    const examples = exampleLines(bin, commands);

    const sections = [
        ['---', `name: ${bin}`, `description: ${descriptionLine(bin, pkg)}`, '---'].join('\n'),
        [
            `# ${bin}`,
            '',
            `Run \`${bin}\` as \`npx ${bin}\` in this project, or as \`${bin}\` when it is installed globally.`,
            '',
            `- Find commands: \`${bin} help --json --brief\`. One command in full: \`${bin} help <command> --json\`.`,
            '- Call with `--json`: one object on stdout. `ok: false` has `error` and often `hint`: do what the hint says.',
            '- Exit codes: 0 ok, 1 the command failed, 2 the command line was wrong.',
            '- Nothing prompts with `--yes` or `--json`. A destructive command needs `--yes`.',
            '- When a result has `next`, those are the commands to run next.',
            '- Long output: add `--quiet`, or `--log <file>` to keep the full output in a file.'
        ].join('\n'),
        authoringSection(bin, commandsDir)
    ];

    if (destructive.length) {
        const listed = destructive.slice(0, SKILL_MAX_DESTRUCTIVE);
        const hidden = destructive.length - listed.length;

        sections.push(
            [
                '## Destructive (need `--yes`; try `--dry-run` first where marked)',
                '',
                ...listed.map((command) => destructiveLine(bin, command)),
                ...(hidden > 0 ? [`- and ${hidden} more: \`${bin} help --json --brief\``] : [])
            ].join('\n')
        );
    }

    if (examples.length) {
        sections.push(['## Examples', '', ...examples].join('\n'));
    }

    return `${sections.join('\n\n')}\n`;
};
