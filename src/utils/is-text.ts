import type { IsBooleanFn, IsTextFn, IsTextListFn } from '../models.js';

/** Whether a value is a boolean. */
export const isBoolean: IsBooleanFn = (value): value is boolean => typeof value === 'boolean';

/** Whether a value is a string. */
export const isText: IsTextFn = (value): value is string => typeof value === 'string';

/** Whether a value is a list of strings. */
export const isTextList: IsTextListFn = (value): value is string[] =>
    Array.isArray(value) && value.every(isText);
