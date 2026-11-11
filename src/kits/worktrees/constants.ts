/** The main checkout is slot 0 and needs no registration; registered worktrees start at 1. */
export const MAIN_SLOT = 0;
export const FIRST_WORKTREE_SLOT = 1;

export const DEFAULT_MAIN_NAME = 'main';
export const DEFAULT_SLOT_STEP = 100;
export const DEFAULT_COLORS = ['blue', 'green', 'magenta', 'cyan', 'yellow', 'red'] as const;

/** An instance name is a lowercase letter or digit, then letters, digits and dashes. */
export const MAX_INSTANCE_NAME_LENGTH = 31;
export const VALID_NAME = new RegExp(`^[a-z0-9][a-z0-9-]{0,${MAX_INSTANCE_NAME_LENGTH - 1}}$`);
export const INVALID_NAME_RUN = /[^a-z0-9-]+/g;
export const EDGE_DASHES = /^-+|-+$/g;
export const FIRST_SUFFIX = 2;
export const FALLBACK_WORKTREE_NAME = 'worktree';

export const STATE_INDENT_SPACES = 4;
export const LOCK_SUFFIX = '.lock';
export const LOCK_TIMEOUT_MS = 10_000;
export const LOCK_POLL_MS = 10;
/** A lock file with no process id in it is probably being written; it is left alone this long. */
export const LOCK_GRACE_MS = 200;
/** Whoever is taking over a stale lock is given this long before the takeover itself counts as abandoned. */
export const TAKEOVER_STALE_MS = 5000;
export const TAKEOVER_SUFFIX = '.takeover';
export const INT32_BYTES = 4;

/** Signal 0 only asks whether the process exists. */
export const PROBE_SIGNAL = 0;
