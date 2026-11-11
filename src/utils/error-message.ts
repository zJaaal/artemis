import type { MessageOfFn } from '../models.js';

/** The message of whatever was thrown: an Error's message, or the value as text. */
export const messageOf: MessageOfFn = (error) =>
    error instanceof Error ? error.message : String(error);
