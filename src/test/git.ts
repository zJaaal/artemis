import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { GIT_TEST_CONFIG, TEMP_REPO_MARKER } from './constants.js';
import type { TempRepo } from './models.js';

/** Runs git in `cwd` with a fixed identity, and returns what it printed. */
export const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', [...GIT_TEST_CONFIG, ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

/** A real repo with a marker folder, so a test's `isCheckout` can tell it from other repos. */
export const makeRepo = (at: string): TempRepo => {
    fs.mkdirSync(path.join(at, TEMP_REPO_MARKER), { recursive: true });
    git(at, 'init', '-q');
    git(at, 'commit', '-q', '--allow-empty', '-m', 'init');

    const root = fs.realpathSync(at);

    return { root, git: (...args) => git(root, ...args) };
};

/** A real `git worktree add` of `repo` at `at`, marked like a checkout. Returns its root. */
export const addWorktree = (repo: TempRepo, at: string): string => {
    repo.git('worktree', 'add', '-q', '--detach', at);
    fs.mkdirSync(path.join(at, TEMP_REPO_MARKER), { recursive: true });

    return fs.realpathSync(at);
};
