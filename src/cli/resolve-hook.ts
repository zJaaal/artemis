import { ERROR_CODE, PACKAGE_NAME } from '../constants.js';
import type { ResolveHookFn } from '../models.js';
import { codeOf } from '../utils/error-code.js';

const isOwnPackage = (specifier: string): boolean =>
    specifier === PACKAGE_NAME || specifier.startsWith(`${PACKAGE_NAME}/`);

/**
 * A command file imports the framework by its package name, but a globally installed `art` is not
 * on the module path of a project's files. Normal resolution always goes first, so a copy the
 * project installed itself wins. Only when that fails with "module not found" for this package (or
 * one of its subpaths) is the name resolved from inside the running copy, so the project needs
 * nothing installed. The `Symbol.for` tags keep definitions from two copies compatible.
 */
export const resolve: ResolveHookFn = async (specifier, context, nextResolve) => {
    try {
        return await nextResolve(specifier, context);
    } catch (error) {
        if (!isOwnPackage(specifier) || codeOf(error) !== ERROR_CODE.MODULE_NOT_FOUND) {
            throw error;
        }

        return nextResolve(specifier, { ...context, parentURL: import.meta.url });
    }
};
