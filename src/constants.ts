import type { StdioOptions } from 'node:child_process';

import type { ExecMode, FlagDefinition, StyleCodes } from './models.js';

/** Exit codes: 0 success, 1 the command failed, 2 the command line was wrong. */
export const EXIT_CODE = { OK: 0, FAILED: 1, USAGE: 2 } as const;

/** The exit codes of a failure: a failed run never exits with OK. */
export const FAILURE_CODES = [EXIT_CODE.FAILED, EXIT_CODE.USAGE] as const;

// Symbol.for, so a definition is recognised even if two copies of Artemis end up loaded
export const COMMAND_TAG = Symbol.for('artemis.command');
export const TOPIC_TAG = Symbol.for('artemis.topic');

// Errors are tagged the same way, so an error thrown by another copy of Artemis (a project's own
// local copy under a global `art`) is still recognised: `instanceof` only knows one copy.
export const COMMAND_ERROR_TAG = Symbol.for('artemis.command-error');
export const USAGE_ERROR_TAG = Symbol.for('artemis.usage-error');
export const EXEC_ERROR_TAG = Symbol.for('artemis.exec-error');

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
    },
    'dry-run': { type: 'boolean', description: 'Say what the command would do, and do none of it' },
    quiet: {
        type: 'boolean',
        description:
            'Hide warnings, Next: lines, the version warning and child output; the result and errors still print'
    },
    log: {
        type: 'string',
        description: 'Write everything the command and its child processes print to this file'
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
export const LOG_FLAG = '--log';
export const LOG_FLAG_PREFIX = '--log=';
export const DRY_RUN_FLAG = '--dry-run';
export const QUIET_FLAG = '--quiet';
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

/** Shows the cursor again: a question that is cancelled may leave it hidden. */
export const SHOW_CURSOR = `${ANSI_ESCAPE}?25h`;

/** Ctrl+C reaches the prompt edge as this key with `ctrl` set, because stdin is in raw mode. */
export const INTERRUPT_KEY = 'c';

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
export const NOT_INTERACTIVE_HINT = 'Pass --yes to skip the question.';
/**
 * `--yes` and `--json` never answer a question, so when one of them was passed and the command asks
 * anyway, "pass --yes" would send the caller round in a circle: it has to answer another way.
 */
export const ASKS_REGARDLESS_HINT =
    'This command asks even with --yes or --json: answer it with the flags it documents (see --help).';
export const CANCELLED_MESSAGE = 'Cancelled.';
export const DESTRUCTIVE_CONFIRM_HINT = 'Pass --yes to confirm.';
/** A word that starts like `FOO=1`: an environment assignment, not a command. */
export const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
export const NEXT_PREFIX = 'Next:';
/** `ctx.exec`: how much of a failed child is kept, and how long a child gets to stop after SIGTERM. */
export const EXEC_TAIL_LINES = 40;
export const EXEC_TAIL_LINE_CHARS = 500;
export const EXEC_START_HINT = 'Check that it is an executable this user may run.';
export const EXEC_KILL_GRACE_MS = 5000;
/** After a child exits, how long its output pipes get to drain before they are cut (a grandchild may hold them open). */
export const EXEC_DRAIN_MS = 200;
export const MS_PER_SECOND = 1000;
export const EXEC_NOT_FOUND_HINT = 'Install it, or check PATH.';
export const EXEC_LOG_HINT_PREFIX = 'Full log:';
export const EXEC_NO_LOG_HINT = 'Run again with --log <file> to keep its full output.';
export const LINE_BREAK = '\n';
/** `w` creates the file or empties the one that is there. */
export const LOG_FILE_OPEN_MODE = 'w';
/** The log is written in batches: when this much is waiting, or this long after the first line waits. */
export const LOG_FLUSH_BYTES = 64 * 1024;
export const LOG_FLUSH_MS = 100;
export const LOG_FILE_HINT = 'Check the folder exists and can be written.';
/** Version ranges: the forms the checker understands. Anything else is "not checked", never a warning. */
export const RANGE_OR = '||';
export const RANGE_WILDCARDS: readonly string[] = ['*', 'x', 'X'];
export const RANGE_OPERATORS = ['>=', '<=', '>', '<', '^', '~', '='] as const;
export const VERSION_PREFIXES = ['v', 'V'] as const;
export const VERSION_PART = /^\d+$/;
export const VERSION_SEPARATOR = '.';
export const VERSION_PARTS_MAX = 3;
export const WHITESPACE = /\s/;
export const RANGE_PRERELEASE_MARKS: readonly string[] = ['-', '+'];
/** The package the doctor and the version warning look for, and where npm puts a copy of it. */
export const ARTEMIS_PACKAGE = '@zjaaal/artemis';
export const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'] as const;
export const DOCTOR_COMMAND_HINT = 'Run art doctor.';
export const VERSION_WARNING_LABEL = 'warning:';
/** `art skill`: how many examples the generated skill lists at most, and the file `help --agents` prints. */
export const SKILL_MAX_EXAMPLES = 10;
export const AGENTS_FILE = 'AGENTS.md';
export const LINE_BREAKS = /\s*[\r\n]+\s*/g;
export const DRY_RUN_HEADER = 'Dry run, nothing was changed. It would:';
export const DRY_RUN_EMPTY = 'Nothing to do.';
export const DRY_RUN_FIRST_HINT = 'Pass --dry-run first to see what it would do.';

export const TABLE_INDENT = '  ';
export const TABLE_GAP = '  ';
export const SECTION_SEPARATOR = '\n\n';
export const NOTE_SEPARATOR = '; ';

/** What help says about the two markers of a command definition. */
export const DESTRUCTIVE_NOTE =
    'Changes or deletes data that cannot be recovered. It asks first; pass --yes to confirm without a question.';
export const DRY_RUN_NOTE = 'Says what it would do and changes nothing.';

/** The tail of the line a brief manifest ends with: how to get one command in full. */
export const BRIEF_MORE_SUFFIX = 'help <command> --json';
export const BRIEF_FLAG = '--brief';
export const AGENTS_FLAG = '--agents';

export const NO_COMMAND = null;

/** What a document file ends with, and what a file being written ends with until it is renamed into place. */
export const JSON_EXTENSION = '.json';
export const TEMP_SUFFIX = '.tmp';

/** Node system error codes the framework reacts to. */
export const ERROR_CODE = {
    EXISTS: 'EEXIST',
    MISSING: 'ENOENT',
    PERMISSION_DENIED: 'EPERM',
    MODULE_NOT_FOUND: 'ERR_MODULE_NOT_FOUND',
    ABORTED: 'ABORT_ERR'
} as const;

/** The package a command file imports the framework from. */
export const PACKAGE_NAME = '@zjaaal/artemis';

/** The shipped binary finds its project through the nearest package.json. */
export const MANIFEST_FILE = 'package.json';
export const CONFIG_KEY = 'artemis';

/** Where npm puts an installed package: a tool in here is always its own package, whatever it holds. */
export const NODE_MODULES = 'node_modules';
export const SCOPE_FOLDER_PREFIX = '@';
export const DEFAULT_COMMANDS_FOLDER = 'commands';
export const DEFAULT_STATE_FOLDER = 'state';
export const DEFAULT_BIN_NAME = 'art';
export const FLAG_WITHOUT_COMMAND_SUBJECT = 'There is no command for';
/** Said where a version cannot be read. */
export const UNKNOWN_VERSION_TEXT = 'an unknown version';
export const VERSION_NOT_CHECKED = 'not checked: the running version is unknown';

/** npm names the command of a string `bin` after the package, without its `@scope/`. */
export const SCOPE_PREFIX = /^@[^/]+\//;

/** A string that is a URL, such as `file:///app/bin.js` or `http://x`, and not a path (`C:\\x` is a path). */
export const URL_LIKE = /^(file:|[a-z][a-z0-9+.-]*:\/\/)/i;

/** How `ctx.exec` starts a child: stdin ignored and both output streams piped, or everything inherited. */
export const EXEC_STDIO_PIPED: StdioOptions = ['ignore', 'pipe', 'pipe'];
export const EXEC_STDIO_INHERITED: StdioOptions = 'inherit';
export const EXEC_OUTPUT_ENCODING = 'utf8';

/** Piped output is split into lines for `tail`; a Windows child ends them with a carriage return too. */
export const LINE_END = '\n';
export const CARRIAGE_RETURN = /\r$/;

/** The mode of a piped child whose output nobody is shown but `tail` keeps. */
export const EXEC_PIPED_HIDDEN: ExecMode = { pipe: true, echo: 'none', keep: true };

/** How many words of the command line a leading flag takes: itself, or itself and its value (`--log file`). */
export const FLAG_ALONE_WORDS = 1;
export const FLAG_WITH_VALUE_WORDS = 2;

/** A version range body has one to three numbers: `1`, `1.2` or `1.2.3`. */
export const VERSION_MAJOR_ONLY = 1;
export const VERSION_MAJOR_MINOR = 2;
export const VERSION_MAJOR_INDEX = 0;
export const VERSION_MINOR_INDEX = 1;
export const VERSION_PATCH_INDEX = 2;
