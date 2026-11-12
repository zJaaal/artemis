import { UsageError } from '../errors/errors.js';
import type { FlagWithoutCommandFn } from '../models.js';
import { FLAG_WITHOUT_COMMAND_SUBJECT, ID_SEPARATOR } from '../constants.js';

/** The refusal of a flag that only goes with a command (`--log`, `--dry-run`) typed where none runs. */
export const flagWithoutCommand: FlagWithoutCommandFn = (
    flag,
    bin,
    subject = FLAG_WITHOUT_COMMAND_SUBJECT
) =>
    new UsageError(`${subject} ${flag}`, {
        hint: `${flag} goes with a command: ${[bin, '<command>', flag]
            .filter((word) => word !== undefined)
            .join(ID_SEPARATOR)}`
    });
