import { spawnSync } from 'node:child_process';

import type { GitRootFn } from '../../models.js';
import { realPathOrResolve } from '../../edges/files.js';

// Edge: asks git which checkout a folder belongs to.
export const gitRoot: GitRootFn = (cwd) => {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });

    return result.status === 0 ? realPathOrResolve(result.stdout.trim()) : null;
};
