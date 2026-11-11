import path from 'node:path';

import { makeDirectory, removeFile, writeText } from '../../edges/files.js';
import { homeDirectory } from '../../edges/system.js';
import { CommandError } from '../../errors/errors.js';
import {
    TAB_CONFIG_EXTENSION,
    TAB_ID_PATTERN,
    WARP_CONFIG_FOLDER,
    WARP_LINK_PREFIX
} from './constants.js';
import type { CheckTabIdFn, WarpFn } from './models.js';
import { openLink } from './open-link.js';
import { toToml } from './toml.js';

/** A tab id is used as a file name and in a link, so anything but a plain word is refused. */
const checkedId: CheckTabIdFn = (id) => {
    if (!TAB_ID_PATTERN.test(id)) {
        throw new CommandError(`"${id}" is not a valid tab id.`, {
            hint: 'Use letters, digits, dashes and underscores only, e.g. "demo_dotcms".'
        });
    }

    return id;
};

/**
 * Warp adapter: each tab becomes a Tab Config (`<id>.toml`) opened through its warp:// link, as a
 * new tab in the focused window (or a new window if none is open).
 */
export const warp: WarpFn = ({
    configDir = path.join(homeDirectory(), WARP_CONFIG_FOLDER),
    open = openLink
} = {}) => {
    const fileOf = (id: string): string =>
        path.join(configDir, `${checkedId(id)}${TAB_CONFIG_EXTENSION}`);

    return {
        write: (tab) => {
            const file = fileOf(tab.id);

            makeDirectory(configDir);
            writeText(file, toToml(tab));
        },
        open: (id) => open(`${WARP_LINK_PREFIX}${checkedId(id)}`),
        remove: (id) => removeFile(fileOf(id))
    };
};
