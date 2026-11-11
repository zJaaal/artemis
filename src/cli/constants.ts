/** A word the shipped `art` handles itself, like `help`: it makes a folder a project. */
export const INIT_WORD = 'init';
export const INIT_USAGE_LINE = `${INIT_WORD} [--json]`;
export const INIT_HELP = `Usage: ${INIT_USAGE_LINE}\n\nMakes the current folder a project: a package.json with an "artemis" key, a commands/ folder and a sample command. Nothing that exists is overwritten. It takes no arguments: go to the folder first.`;

/** The only flags \`init\` takes: it is a fixed word of the binary, not a command, so it needs no more. */
export const INIT_FLAGS = { json: '--json', help: '--help', helpShort: '-h' } as const;

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
