import { FLAG_PREFIX } from '../constants.js';
import type { IsFlagTokenFn } from '../models.js';

/** Whether a command line word is a flag (it starts with a dash). `--` itself is one: callers that care check for it first. */
export const isFlagToken: IsFlagTokenFn = (token) => token.startsWith(FLAG_PREFIX);
