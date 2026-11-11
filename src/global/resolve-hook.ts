import { PACKAGE_NAME } from './constants.js';
import type { ResolveHookFn } from './models.js';

const isOwnPackage = (specifier: string): boolean =>
    specifier === PACKAGE_NAME || specifier.startsWith(`${PACKAGE_NAME}/`);

/**
 * Command files import the framework by its package name, but a global install is not on the
 * module path of the files in a project. This hook resolves that name from inside the running
 * copy of the package, so every command file gets the same Artemis that is running it, with
 * nothing installed in the project.
 */
export const resolve: ResolveHookFn = (specifier, context, nextResolve) =>
    nextResolve(
        specifier,
        isOwnPackage(specifier) ? { ...context, parentURL: import.meta.url } : context
    );
