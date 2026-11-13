import type { Builtin } from '../models.js';

/** A word the shipped `art` handles itself, like `help`: it makes a folder a project. */
export const INIT_WORD = 'init';
export const INIT_USAGE_LINE = `${INIT_WORD} [--quiet] [--json]`;
export const INIT_HELP = `Usage: ${INIT_USAGE_LINE}\n\nMakes the current folder a project: a package.json with an "artemis" key, a commands/ folder and a sample command. Nothing that exists is overwritten. It takes no arguments: go to the folder first.`;

/** The only flags \`init\` takes: it is a fixed word of the binary, not a command, so it needs no more. */
export const INIT_FLAGS = {
    json: '--json',
    help: '--help',
    helpShort: '-h',
    quiet: '--quiet'
} as const;

/** What `init` writes for the declaration, and the fields of a package.json it has to create. */
export const INIT_DECLARATION = { commandsDir: 'commands' } as const;
export const NEW_MANIFEST_FIELDS = { private: true, type: 'module' } as const;

/** The command `init` writes so that `art hello` works right away. */
export const SAMPLE_COMMAND_FILE = 'hello.js';
export const SAMPLE_COMMAND_SOURCE = `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Say hello',
    args: [{ name: 'name', description: 'Who to greet', default: 'world' }],
    run({ args, ctx }) {
        const greeting = \`hello \${args.name}\`;

        ctx.log(greeting);

        return { greeting };
    }
});
`;

export const FALLBACK_PACKAGE_NAME = 'project';
export const DEFAULT_INDENT_SPACES = 2;
export const INDENT_PATTERN = /^([ \t]+)"/m;
export const PACKAGE_NAME_INVALID = /[^a-z0-9._-]+/g;
export const PACKAGE_NAME_EDGES = /^[-._]+|-+$/g;

export const TYPE_WARNING =
    'Your package.json does not say "type": "module". Command files are ES modules, so Node prints a warning for each one until it does.';

export const SHADOW_WARNING =
    'This project has a command or topic called "init", and the init word of this binary hides it: it cannot be run through here. Rename it.';
export const CRLF = '\r\n';
export const LF = '\n';

/** `state` is the second word of the shipped binary that is not a command file: it lists, shows and resets what the app keeps. */
export const STATE_WORD = 'state';
export const STATE_USAGE_LINE = `${STATE_WORD} [<doc>] [--reset] [--yes] [--quiet] [--json]`;
export const STATE_HELP = `Usage: ${STATE_USAGE_LINE}

Lists the documents the app keeps in its state folder, shows one, or resets one so the app starts again from its defaults.

  ${STATE_WORD}                   list the documents
  ${STATE_WORD} <doc>             show one
  ${STATE_WORD} <doc> --reset     delete it (asks first; --yes skips the question)

The folder is "artemis".stateDir in package.json (default "state").`;

export const STATE_FLAGS = {
    json: '--json',
    help: '--help',
    helpShort: '-h',
    yes: '--yes',
    yesShort: '-y',
    reset: '--reset',
    quiet: '--quiet'
} as const;

export const STATE_SHADOW_WARNING =
    'This project has a command or topic called "state", and the state word of this binary hides it: it cannot be run through here. Rename it.';

export const STATE_RESET_HINT = 'Pass --yes to reset without a question.';
export const STATE_RECOVERY_HINT = 'Reset it with --reset to start again from the defaults.';
export const NO_STATE_YET = 'No state yet in';

/** `doctor` checks the install and the project, and says how to fix each problem. */
export const DOCTOR_WORD = 'doctor';
export const DOCTOR_USAGE_LINE = `${DOCTOR_WORD} [--quiet] [--json]`;
export const DOCTOR_HELP = `Usage: ${DOCTOR_USAGE_LINE}

Checks the install and the project: which Artemis runs and which one the project wants, that the commands load, that no command hides a word of this binary, and that the state documents can be read. Every problem comes with a fix. It exits 1 when a check fails (warnings do not).`;

export const DOCTOR_FLAGS = {
    json: '--json',
    help: '--help',
    helpShort: '-h',
    quiet: '--quiet'
} as const;

/** `skill` writes a short SKILL.md from the manifest, so an agent finds the commands without reading a page. */
export const SKILL_WORD = 'skill';
export const SKILL_USAGE_LINE = `${SKILL_WORD} [--write <path>] [--yes] [--quiet] [--json]`;
export const SKILL_HELP = `Usage: ${SKILL_USAGE_LINE}

Prints a short SKILL.md built from the commands of this project: how to find a command, how to call it, which ones are destructive and a few examples. With --write <path> it writes the file instead (creating the folders), and asks before it overwrites one (--yes skips the question).`;

export const SKILL_FLAGS = {
    json: '--json',
    help: '--help',
    helpShort: '-h',
    yes: '--yes',
    yesShort: '-y',
    quiet: '--quiet',
    write: '--write'
} as const;

export const SKILL_SHADOW_WARNING =
    'This project has a command or topic called "skill", and the skill word of this binary hides it: it cannot be run through here. Rename it.';
export const SKILL_OVERWRITE_HINT_PREFIX = 'Pass --yes to overwrite';
export const SKILL_WRITE_HINT = 'Give --write the path of a file, in a folder that can be created.';

/** `history` shows what the audit trail recorded: the newest runs of project commands first. */
export const HISTORY_WORD = 'history';
/** What `--limit` takes: a whole number, 1 or more. */
export const POSITIVE_INTEGER = /^[1-9]\d*$/;
export const HISTORY_USAGE_LINE = `${HISTORY_WORD} [command words]... [--limit <n>] [--json] [--quiet]`;
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_HELP = `Usage: ${HISTORY_USAGE_LINE}

Shows the runs of project commands that the audit trail recorded, the newest first: when, which command, whether it was a dry run or its exit code, and its arguments. The command words filter to one command (its id, or an alias); --limit says how many to show (default ${HISTORY_DEFAULT_LIMIT}).

The trail is audit.jsonl in the state folder ("artemis".stateDir in package.json, default "state"), and "artemis": { "audit": false } turns it off.`;

export const HISTORY_FLAGS = {
    json: '--json',
    help: '--help',
    helpShort: '-h',
    quiet: '--quiet',
    limit: '--limit'
} as const;

export const HISTORY_SHADOW_WARNING =
    'This project has a command or topic called "history", and the history word of this binary hides it: it cannot be run through here. Rename it.';
export const HISTORY_LIMIT_HINT =
    'Give --limit a whole number of runs, 1 or more: history --limit 5';
export const NOTHING_RECORDED = 'Nothing recorded yet.';
export const HISTORY_DRY_RUN_TEXT = 'dry run';
export const HISTORY_LIMIT_PREFIX = `${HISTORY_FLAGS.limit}=`;

/** The words of the shipped binary that help lists under "Built-in" and `help --json` under "builtins". */
export const BUILTINS: readonly Builtin[] = [
    {
        id: INIT_WORD,
        usage: INIT_USAGE_LINE,
        description: 'Make the current folder a project',
        args: [],
        flags: {},
        examples: [INIT_WORD]
    },
    {
        id: STATE_WORD,
        usage: STATE_USAGE_LINE,
        description: 'List, show or reset the documents the app keeps',
        args: [{ name: 'doc', description: 'The document to show or reset' }],
        flags: {
            reset: {
                type: 'boolean',
                description: 'Delete the document so the app starts again from its defaults'
            }
        },
        examples: [STATE_WORD, `${STATE_WORD} steps`, `${STATE_WORD} steps --reset --yes`]
    },
    {
        id: SKILL_WORD,
        usage: SKILL_USAGE_LINE,
        description: 'Write a short SKILL.md for agents, from the commands of this project',
        args: [],
        flags: {
            write: {
                type: 'string',
                description: 'Write the file here instead of printing it'
            }
        },
        examples: [SKILL_WORD, `${SKILL_WORD} --write .claude/skills/art/SKILL.md`]
    },
    {
        id: DOCTOR_WORD,
        usage: DOCTOR_USAGE_LINE,
        description: 'Check the install and the project, and say how to fix each problem',
        args: [],
        flags: {},
        examples: [DOCTOR_WORD]
    },
    {
        id: HISTORY_WORD,
        usage: HISTORY_USAGE_LINE,
        description: 'Show the recorded runs of project commands, newest first',
        args: [
            { name: 'command', description: 'Only this command, by id or alias (several words)' }
        ],
        flags: {
            limit: {
                type: 'string',
                description: `How many runs to show (default ${HISTORY_DEFAULT_LIMIT})`
            }
        },
        examples: [HISTORY_WORD, `${HISTORY_WORD} db reset`, `${HISTORY_WORD} --limit 5 --json`]
    }
];

/** Every word the shipped binary handles itself: a project command or topic with one of these names is hidden. */
export const WORD_NAMES: readonly string[] = BUILTINS.map((builtin) => builtin.id);

/** How `doctor` lays out a check in text: the status label, the id padded to the longest, the fix under it. */
export const DOCTOR_STATUS_LABEL = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' } as const;
export const DOCTOR_ID_WIDTH = 'history-previewed'.length;
export const DOCTOR_FIX_INDENT = '      ';

export const SKILL_WRITE_PREFIX = `${SKILL_FLAGS.write}=`;
export const DOCTOR_SINGULAR_FAILED = '1 check failed';

/** Between the names of the commands a health check lists, and between the fixes it gives. */
export const LIST_SEPARATOR = ', ';
export const FIX_SEPARATOR = ' ';
