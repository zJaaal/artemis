import type { IsThenableFn } from '../models.js';

/** Whether a value is a promise, or looks like one. */
export const isThenable: IsThenableFn = (value): value is PromiseLike<unknown> =>
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function';
