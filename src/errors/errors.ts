import { COMMAND_ERROR_TAG, EXEC_ERROR_TAG, EXIT_CODE, USAGE_ERROR_TAG } from '../constants.js';
import type {
    CommandErrorOptions,
    CommandErrorShape,
    ExecErrorOptions,
    ExecErrorShape,
    ExitCode,
    IsCommandErrorFn,
    IsExecErrorFn,
    IsUsageErrorFn,
    UsageErrorOptions,
    UsageErrorShape
} from '../models.js';
import { hasTag } from '../utils/tag.js';

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
        Object.defineProperty(this, COMMAND_ERROR_TAG, { value: true });
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
        Object.defineProperty(this, USAGE_ERROR_TAG, { value: true });
    }
}

/** A child run through `ctx.exec` failed. It carries the last lines of its output for the envelope's `tail`. */
export class ExecError extends CommandError {
    /** The last lines the child printed, each cut. */
    readonly tail: readonly string[];

    /** Whether a person has to be shown them under the error (the child's output was hidden). */
    readonly showTail: boolean;

    constructor(message: string, { tail, showTail, ...options }: ExecErrorOptions) {
        super(message, options);
        this.name = 'ExecError';
        this.tail = tail;
        this.showTail = showTail;
        Object.defineProperty(this, EXEC_ERROR_TAG, { value: true });
    }
}

/**
 * Whether something is an expected failure (a `CommandError`), even one thrown by another copy of
 * Artemis, where `instanceof` would say no and the hint and exit code would be lost.
 */
export const isCommandError: IsCommandErrorFn = (value): value is CommandErrorShape =>
    value instanceof Error && hasTag(value, COMMAND_ERROR_TAG);

/** Whether something is a wrong-command-line failure (a `UsageError`), from any copy of Artemis. */
export const isUsageError: IsUsageErrorFn = (value): value is UsageErrorShape =>
    isCommandError(value) && hasTag(value, USAGE_ERROR_TAG);

/** Whether something is a failed `ctx.exec` (an `ExecError`). */
export const isExecError: IsExecErrorFn = (value): value is ExecErrorShape =>
    isCommandError(value) && hasTag(value, EXEC_ERROR_TAG);
