import { fileURLToPath } from 'node:url';

export const COMMANDS_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/commands', import.meta.url));

export const PROMPTS_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/prompts', import.meta.url));

export const BAD_COMMANDS_FIXTURE_DIR = fileURLToPath(
    new URL('./fixtures/bad-commands', import.meta.url)
);

/** Identity and defaults for git, so no test reads the machine's global git config. */
export const GIT_TEST_CONFIG = [
    '-c',
    'user.name=artemis-test',
    '-c',
    'user.email=artemis-test@example.com',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'init.defaultBranch=main'
] as const;

export const TEMP_REPO_MARKER = 'marker';

export const ALIAS_CLASH_FIXTURE_DIR = fileURLToPath(
    new URL('./fixtures/alias-clash', import.meta.url)
);

export const ALIAS_TOPIC_FIXTURE_DIR = fileURLToPath(
    new URL('./fixtures/alias-topic', import.meta.url)
);

export const MISSING_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/not-there', import.meta.url));

/** Base values for the worktrees kit tests; expectations are built from them, never copied. */
export const KIT_BASE_PORTS = { http: 8080, frontend: 4200 } as const;
export const KIT_SLOT_STEP = 100;
export const KIT_COLORS = ['blue', 'green', 'magenta'] as const;
export const KIT_LOCK_TIMEOUT_MS = 100;

/** The most bytes the brief listing of the fixture commands may take (it was 2.7 KB before `usage`). */
export const BRIEF_FIXTURE_MAX_BYTES = 4096;

/** The most bytes the folded top-level brief listing of a 200-command project may take. */
export const BRIEF_FOLDED_MAX_BYTES = 6144;

/** The user id of root, who can read a folder whose mode is 0. */
export const ROOT_UID = 0;
export const UNREADABLE_MODE = 0;
export const OWNER_MODE = 0o700;
/** A folder that can be listed and written but not entered: the owner has no execute bit. */
export const NO_EXECUTE_MODE = 0o600;

/** Whether the tests run on Windows. */
export const IS_WINDOWS = process.platform === 'win32';

/**
 * Why a test cannot run on Windows. Each reason is a name, so the `test.skipIf(...)` that uses it says
 * why it is skipped, and a test is never skipped for "it fails there" without a reason.
 */
export const NO_PERMISSION_BITS = IS_WINDOWS; // chmod changes nothing there: a folder cannot be made unreadable or un-enterable
export const NO_EXECUTE_BIT = IS_WINDOWS; // a file without the execute bit is not a thing; spawning a script says EFTYPE, not EACCES
export const NO_SIGNALS = IS_WINDOWS; // there are no signals: a killed child ends with an exit code, not a signal name
export const NO_PROCESS_GROUPS = IS_WINDOWS; // there are no process groups to be the leader of
export const NO_SYMLINK_LOOPS = IS_WINDOWS; // symlinks need a privilege a CI user may not have
export const NO_OTHER_USERS_PROCESS = IS_WINDOWS; // there is no process 1 that belongs to someone else to probe
export const REFUSES_RENAME_OVER_OPEN_FILE = IS_WINDOWS; // a rename over a file another handle has open fails there (see writeAtomic's retries)
/** https://github.com/zJaaal/artemis/issues/20: the grandchild writes nothing at all on Windows, and nobody knows why yet. */
export const UNDIAGNOSED_GRANDCHILD_PIPE = IS_WINDOWS;
