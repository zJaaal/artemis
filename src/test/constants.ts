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
