// ---- Worktrees kit ----------------------------------------------------------------------------

/** The main checkout is slot 0 and needs no registration; registered worktrees start at 1. */
export const MAIN_SLOT = 0;
export const FIRST_WORKTREE_SLOT = 1;

export const DEFAULT_MAIN_NAME = 'main';
export const DEFAULT_SLOT_STEP = 100;
export const DEFAULT_COLORS = ['blue', 'green', 'magenta', 'cyan', 'yellow', 'red'] as const;

/** An instance name is a lowercase letter or digit, then letters, digits and dashes. */
export const MAX_INSTANCE_NAME_LENGTH = 31;
export const FALLBACK_WORKTREE_NAME = 'worktree';

export const STATE_INDENT_SPACES = 4;
export const LOCK_SUFFIX = '.lock';
export const LOCK_TIMEOUT_MS = 10_000;
export const LOCK_POLL_MS = 10;
export const INT32_BYTES = 4;

/** Signal 0 only asks whether the process exists. */
export const PROBE_SIGNAL = 0;
export const PERMISSION_DENIED = 'EPERM';
export const FILE_EXISTS = 'EEXIST';

// ---- Terminal kit -----------------------------------------------------------------------------

export const WARP_CONFIG_FOLDER = '.warp/tab_configs';
export const WARP_LINK_PREFIX = 'warp://tab_config/';
export const TAB_CONFIG_EXTENSION = '.toml';
export const OPEN_COMMAND = 'open';
export const ROOT_PANE_ID = 'root';
export const FIRST_PANE_ID = 'pane_1';
export const PANE_ID_PREFIX = 'pane_';
export const SPLIT_ID_PREFIX = 'split_';
