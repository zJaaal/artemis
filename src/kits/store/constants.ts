export const LOCK_SUFFIX = '.lock';
export const LOCK_TIMEOUT_MS = 10_000;
export const LOCK_POLL_MS = 10;
/** A lock file with no process id in it is probably being written; it is left alone this long. */
export const LOCK_GRACE_MS = 200;
/** Whoever is taking over a stale lock is given this long before the takeover itself counts as abandoned. */
export const TAKEOVER_STALE_MS = 5000;
export const TAKEOVER_SUFFIX = '.takeover';
export const INT32_BYTES = 4;

/** A named lock may be held for minutes (a build), so it is polled gently. */
export const NAMED_LOCK_POLL_MS = 1000;

/** A label on a named lock is one short line: it is shown to whoever waits, and written into the lock file. */
export const LOCK_LABEL_MAX_LENGTH = 120;
export const LOCK_FIELD_SEPARATOR = ' ';
export const LINE_BREAK = /[\r\n]/;

/** Signal 0 only asks whether the process exists. */
export const PROBE_SIGNAL = 0;

/** A document name: a lowercase letter or digit, then letters, digits and dashes. */
export const MAX_DOC_NAME_LENGTH = 64;
export const DOC_NAME = new RegExp(`^[a-z0-9][a-z0-9-]{0,${MAX_DOC_NAME_LENGTH - 1}}$`);

/** JSON is written with this indentation and a trailing newline. */
export const STORE_INDENT_SPACES = 4;

/** Version 0 is plain JSON, as every file was before the store existed; from 1 on the file wraps its data. */
export const UNVERSIONED = 0;
export const FIRST_VERSION = 1;
export const VERSION_KEY = '$version';
export const DATA_KEY = 'data';
/** An upgrade is keyed by the whole version it produces: 1, 2, 3 and so on. */
export const UPGRADE_KEY = /^[1-9][0-9]*$/;

export const CORRUPT_DOCUMENT_HINT = 'Fix the file, or delete it to start again from the defaults.';
export const SYNC_ONLY_ADVICE = 'must be synchronous; use store.lock() for async work';
export const ABANDONED_WORK_ADVICE =
    'was called by async work that locked() or update() refused; use store.lock() for async work';

/** Where the memory store pretends its documents are: nothing is ever written there. */
export const MEMORY_DIR = '/artemis-memory-store';
