import { pathToFileURL } from 'node:url';

import type { ImportDefaultFn } from '../models.js';

// Edge: loads a command file the way Node loads any ES module, and returns its default export.
export const importDefault: ImportDefaultFn = async (file) => {
    const loaded: { default?: unknown } = await import(pathToFileURL(file).href);

    return loaded.default;
};
