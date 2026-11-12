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

/** The words of the shipped binary that help lists under "Built-in" and `help --json` under "builtins". */
export const BUILTINS: readonly Builtin[] = [
    {
        id: INIT_WORD,
        description: 'Make the current folder a project',
        args: [],
        flags: {},
        examples: [INIT_WORD]
    },
    {
        id: STATE_WORD,
        description: 'List, show or reset the documents the app keeps',
        args: [{ name: 'doc', description: 'The document to show or reset' }],
        flags: {
            reset: {
                type: 'boolean',
                description: 'Delete the document so the app starts again from its defaults'
            }
        },
        examples: [STATE_WORD, `${STATE_WORD} steps`, `${STATE_WORD} steps --reset --yes`]
    }
];
