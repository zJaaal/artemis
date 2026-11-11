import type { CommandErrorOptions, ExitCode, UsageErrorOptions } from './models.js';

// Stub: implemented in step 6.
export class CommandError extends Error {
    readonly hint: string | undefined;
    readonly exitCode: ExitCode = 1;

    constructor(message: string, options: CommandErrorOptions = {}) {
        super(message, { cause: options.cause });
        throw new Error('not implemented');
    }
}

export class UsageError extends CommandError {
    readonly usage: string | undefined;

    constructor(message: string, options: UsageErrorOptions = {}) {
        super(message, options);
    }
}
