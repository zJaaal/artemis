import { isFolder, readManifest } from '../edges/files.js';
import type { ProjectOrThrowFn } from '../models.js';
import { findProject, noProjectError } from './settings.js';

// Wiring: the pure project search of settings.ts, given the real disk.

/**
 * The project of a folder, or the no-project error for the route that says what to create. The one place
 * the launcher and the words of the binary (`history`, `new`) find a project from.
 */
export const projectOrThrow: ProjectOrThrowFn = (cwd, route) => {
    const project = findProject(cwd, readManifest, isFolder, route);

    if (!project) {
        throw noProjectError(cwd, route);
    }

    return project;
};
