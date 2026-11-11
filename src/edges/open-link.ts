import { spawnSync } from 'node:child_process';

import { OPEN_COMMAND } from '../kits/constants.js';
import { CommandError } from '../errors.js';
import type { OpenLinkFn } from '../kits/models.js';

// Edge: opens a link with the macOS `open` command.
export const openLink: OpenLinkFn = (url) => {
    const result = spawnSync(OPEN_COMMAND, [url], { encoding: 'utf8' });

    if (result.status !== 0) {
        throw new CommandError(`Warp did not open ${url}: ${String(result.stderr ?? '').trim()}`, {
            hint: 'Check Warp is installed and handles warp:// links.'
        });
    }
};
