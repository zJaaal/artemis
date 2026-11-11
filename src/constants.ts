import type { FlagDefinition, StyleCodes } from './models.js';

/** Exit codes: 0 success, 1 the command failed, 2 the command line was wrong. */
export const EXIT_CODE = { OK: 0, FAILED: 1, USAGE: 2 } as const;

// Symbol.for, so a definition is recognised even if two copies of Artemis end up loaded
export const COMMAND_TAG = Symbol.for('artemis.command');
export const TOPIC_TAG = Symbol.for('artemis.topic');

// Errors are tagged the same way, so an error thrown by another copy of Artemis (a project's own
// local copy under a global `art`) is still recognised: `instanceof` only knows one copy.
export const COMMAND_ERROR_TAG = Symbol.for('artemis.command-error');
export const USAGE_ERROR_TAG = Symbol.for('artemis.usage-error');

export const FLAG_TYPES = ['boolean', 'string'] as const;

/** A short flag is a single character (`-s`); the parser rejects anything else. */
export const SHORT_FLAG_LENGTH = 1;

/** The flags every command gets. Their names and shorts are reserved. */
export const GLOBAL_FLAGS = {
    help: { type: 'boolean', short: 'h', description: 'Show help for the command' },
    json: { type: 'boolean', description: 'Print the result (or the error) as JSON on stdout' },
    yes: {
        type: 'boolean',
        short: 'y',
        description: 'Never prompt; use flags, saved values or defaults'
    }
} as const satisfies Record<string, FlagDefinition>;

export const RESERVED_FLAGS: readonly string[] = Object.keys(GLOBAL_FLAGS);

/** The global flags as typed on a command line: `--json`, `-y`, ... */
export const GLOBAL_FLAG_TOKENS: readonly string[] = Object.entries(GLOBAL_FLAGS).flatMap(
    ([name, flag]) => [`--${name}`, ...('short' in flag ? [`-${flag.short}`] : [])]
);

export const RESERVED_SHORTS: readonly string[] = Object.values(GLOBAL_FLAGS).flatMap((flag) =>
    'short' in flag ? [flag.short] : []
);

export const HELP_WORD = 'help';

/** Ends the flags: everything after it is a plain argument. */
export const TERMINATOR = '--';
export const JSON_FLAG = '--json';
export const FLAG_PREFIX = '-';

/** Files and folders starting with one of these are private: helpers, data, the topic file. */
export const PRIVATE_PREFIXES = ['_', '.'] as const;
export const COMMAND_EXTENSION = '.js';
export const TOPIC_FILE = '_topic.js';

/** Words of a command id are joined with this ("uve config set"); "uve:config:set" also works. */
export const ID_SEPARATOR = ' ';
export const ALIAS_SEPARATOR = ':';

/** Node appends a paragraph about "--" to unknown option errors; the first sentence is the useful part. */
export const ERROR_SENTENCE_SEPARATOR = '. ';

/** A typo is suggested when it is within this many edits, or a third of the name's length. */
export const SUGGEST_MIN_DISTANCE = 2;
export const SUGGEST_LENGTH_DIVISOR = 3;

export const ANSI_ESCAPE = '\u001b[';
export const ANSI_RESET = 0;

/** SGR codes of each style. */
export const STYLE_CODES = {
    bold: 1,
    dim: 2,
    red: 31,
    green: 32,
    yellow: 33,
    cyan: 36
} as const satisfies StyleCodes;

export const DEFAULT_COLOR_ENV = 'NO_COLOR';

export const NOT_INTERACTIVE_MESSAGE =
    'This command needs input, but it is not running interactively.';
export const NOT_INTERACTIVE_HINT =
    'Pass --yes to run without questions, or pass the flags that answer them (see --help).';
export const CANCELLED_MESSAGE = 'Cancelled.';

export const TABLE_INDENT = '  ';
export const TABLE_GAP = '  ';
export const SECTION_SEPARATOR = '\n\n';
export const NOTE_SEPARATOR = '; ';

export const NO_COMMAND = null;

/** Node system error codes the framework reacts to. */
export const ERROR_CODE = {
    EXISTS: 'EEXIST',
    MISSING: 'ENOENT',
    PERMISSION_DENIED: 'EPERM',
    MODULE_NOT_FOUND: 'ERR_MODULE_NOT_FOUND'
} as const;

/** The package a command file imports the framework from. */
export const PACKAGE_NAME = '@zjaaal/artemis';

/** The shipped binary finds its project through the nearest package.json. */
export const MANIFEST_FILE = 'package.json';
export const CONFIG_KEY = 'artemis';
export const DEFAULT_COMMANDS_FOLDER = 'commands';
export const DEFAULT_BIN_NAME = 'art';

/** npm names the command of a string `bin` after the package, without its `@scope/`. */
export const SCOPE_PREFIX = /^@[^/]+\//;
