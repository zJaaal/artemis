import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { URL_LIKE } from '../../constants.js';
import { isFolder, readManifest } from '../../edges/files.js';
import { CommandError } from '../../errors/errors.js';
import { findProject, noProjectError, resolveStateDir } from '../../cli/settings.js';
import { messageOf } from '../../utils/error-message.js';
import type { FolderOfProjectFn, ResolveProjectDirFn } from './models.js';

/** The folder of the file a project location points at (`import.meta.url`), or the folder itself. */
const folderOfProject: FolderOfProjectFn = (location) => {
    let target: string;

    // A relative path would be read from the current folder, which is what `project` never does.
    if (typeof location === 'string' && !URL_LIKE.test(location) && !path.isAbsolute(location)) {
        throw new TypeError(
            `defineStore({ project }) cannot take the relative path "${location}": pass import.meta.url, or an absolute path or URL.`
        );
    }

    try {
        target =
            typeof location === 'string' && !URL_LIKE.test(location)
                ? location
                : fileURLToPath(location);
    } catch (error) {
        throw new CommandError(
            `defineStore({ project }) needs the location of a file in your project, but got ${String(location)} (${messageOf(error)})`,
            { hint: 'Pass import.meta.url, or a path.' }
        );
    }

    return isFolder(target) ? target : path.dirname(target);
};

/**
 * The state folder of the project a file belongs to: the same one `art state` reads, because both
 * ask `resolveStateDir`. The search starts from the folder of `location`, never from the current
 * folder, so the answer does not depend on where the command was run.
 */
export const resolveProjectDir: ResolveProjectDirFn = (location) => {
    const start = folderOfProject(location);
    const project = findProject(start, readManifest, isFolder, 'shipped');

    if (!project) {
        throw noProjectError(start, 'shipped');
    }

    return resolveStateDir(project);
};
