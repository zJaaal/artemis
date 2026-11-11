/** A word the shipped `art` handles itself, like `help`: it makes a folder a project. */
export const INIT_WORD = 'init';

export const INIT_FLAG_JSON = '--json';
export const INIT_FLAG_HELP = '--help';
export const INIT_FLAG_HELP_SHORT = '-h';

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
