import type { CanDestroyFn } from '../models.js';

/**
 * Whether a command can change or delete data, as everything that only describes it reads it: `true`,
 * and also a function, because a reader (help, an agent, a health check) cannot run it for a call.
 */
export const canDestroy: CanDestroyFn = (value) => value !== undefined && value !== false;
