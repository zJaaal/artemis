import { EXIT_CODE } from '../constants.js';
import type { CommandErrorOptions, ExitCode, UsageErrorOptions } from '../models.js';

/**
 * An expected failure: the message (and hint) is shown to the user, without a stack trace.
 * Throw it from a command when something went wrong that the caller can fix.
 */
export class CommandError extends Error {
    /** How to fix the call, shown after the message. */
    readonly hint: string | undefined;

    /** The process exit code this failure maps to. */
    readonly exitCode: ExitCode;

    constructor(
        message: string,
        { hint, exitCode = EXIT_CODE.FAILED, cause }: CommandErrorOptions = {}
    ) {
        super(message, { cause });
        this.name = 'CommandError';
        this.hint = hint;
        this.exitCode = exitCode;
    }
}

/** The command line itself is wrong (unknown command, bad argument). Exits with 2. */
export class UsageError extends CommandError {
    /** The usage line of the command, shown after the message. */
    readonly usage: string | undefined;

    constructor(message: string, { hint, usage }: UsageErrorOptions = {}) {
        super(message, { hint, exitCode: EXIT_CODE.USAGE });
        this.name = 'UsageError';
        this.usage = usage;
    }
}
