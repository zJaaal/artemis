import { fileURLToPath } from 'node:url';

export const COMMANDS_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/commands', import.meta.url));

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

export const MISSING_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/not-there', import.meta.url));
