import type { IsTaggedFn } from '../models.js';

/** Whether a value carries a `Symbol.for` tag, which survives two copies of the package being loaded. */
export const hasTag: IsTaggedFn = (value, tag) => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const found: unknown = Reflect.get(value, tag);

    return Boolean(found);
};
