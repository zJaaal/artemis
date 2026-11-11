import path from 'node:path';

import { makeDirectory, removeFile, writeText } from '../../edges/files.js';
import { openLink } from '../../edges/open-link.js';
import { homeDirectory } from '../../edges/system.js';
import { TAB_CONFIG_EXTENSION, WARP_CONFIG_FOLDER, WARP_LINK_PREFIX } from '../constants.js';
import type { WarpFn } from '../models.js';
import { toToml } from './toml.js';

/**
 * Warp adapter: each tab becomes a Tab Config (`<id>.toml`) opened through its warp:// link, as a
 * new tab in the focused window (or a new window if none is open).
 */
export const warp: WarpFn = ({
    configDir = path.join(homeDirectory(), WARP_CONFIG_FOLDER),
    open = openLink
} = {}) => {
    const fileOf = (id: string): string => path.join(configDir, `${id}${TAB_CONFIG_EXTENSION}`);

    return {
        write: (tab) => {
            makeDirectory(configDir);
            writeText(fileOf(tab.id), toToml(tab));
        },
        open: (id) => open(`${WARP_LINK_PREFIX}${id}`),
        remove: (id) => removeFile(fileOf(id))
    };
};
