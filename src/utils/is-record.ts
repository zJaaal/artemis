import type { IsRecordFn } from '../models.js';

/** A plain object: not null, not an array. */
export const isRecord: IsRecordFn = (value): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
