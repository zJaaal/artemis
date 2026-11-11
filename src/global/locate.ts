import path from 'node:path';

import { COMMANDS_FOLDER, ENV_COMMANDS, ENV_HOME, PROJECT_FOLDER } from './constants.js';
import type { AncestorsFn, LocateCommandsFn, UserCommandsDirFn } from './models.js';

/** `~/.artemis/commands`, or under `ARTEMIS_HOME` when the machine sets it. */
export const userCommandsDir: UserCommandsDirFn = (home, env) =>
    path.join(env[ENV_HOME] || path.join(home, PROJECT_FOLDER), COMMANDS_FOLDER);

/** The folder itself, then each parent, up to the root of the disk. */
const ancestorsOf: AncestorsFn = (dir) => {
    const parent = path.dirname(dir);

    return parent === dir ? [dir] : [dir, ...ancestorsOf(parent)];
};

const projectCandidates = (cwd: string): string[] =>
    ancestorsOf(path.resolve(cwd)).map((dir) => path.join(dir, PROJECT_FOLDER, COMMANDS_FOLDER));

/**
 * Decides which one commands folder a run uses. Pure: whether a folder exists is asked through
 * `isFolder`. The order is: `ARTEMIS_COMMANDS`, the nearest `.artemis/commands` from the current
 * folder upwards, then the user-level folder. Folders are never merged, so projects stay isolated.
 */
export const locateCommands: LocateCommandsFn = ({ cwd, home, env, isFolder }) => {
    const pinned = env[ENV_COMMANDS];

    if (pinned) {
        return { kind: 'found', location: { dir: path.resolve(cwd, pinned), source: 'env' } };
    }

    const userDir = userCommandsDir(home, env);
    const candidates = projectCandidates(cwd);
    const nearest = candidates.find(isFolder);

    if (nearest) {
        const source = nearest === userDir ? 'user' : 'project';

        return { kind: 'found', location: { dir: nearest, source } };
    }

    if (isFolder(userDir)) {
        return { kind: 'found', location: { dir: userDir, source: 'user' } };
    }

    return { kind: 'missing', searched: [...candidates, userDir] };
};
