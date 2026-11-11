import { EXIT_CODE } from '../constants.js';
import { CommandError, UsageError } from '../errors/errors.js';
import type { ErrorReport, ReportContext, ReportErrorFn } from '../models.js';
import { messageOf } from '../utils/error-message.js';

/** Splits an error into what the user sees; only a plain error (a bug) carries its stack. */
function describeError(error: unknown): ErrorReport {
    const isExpected = error instanceof CommandError;

    return {
        message: messageOf(error),
        hint: isExpected ? error.hint : undefined,
        usage: error instanceof UsageError ? error.usage : undefined,
        stack: !isExpected && error instanceof Error ? error.stack : undefined,
        exitCode: isExpected ? error.exitCode : EXIT_CODE.FAILED
    };
}

function toJson(report: ErrorReport, commandId: string | undefined): string {
    return JSON.stringify({
        ok: false,
        command: commandId ?? null,
        error: report.message,
        ...(report.hint ? { hint: report.hint } : {})
    });
}

function toText(report: ErrorReport, { style }: ReportContext): string {
    const lines = [`${style.red('Error:')} ${report.message}`];

    if (report.hint) {
        lines.push(`${style.yellow('Hint:')} ${report.hint}`);
    }

    if (report.usage) {
        lines.push('', `${style.bold('Usage')}  ${report.usage}`);
    }

    if (report.stack) {
        lines.push('', style.dim(report.stack));
    }

    return lines.join('\n');
}

/**
 * Prints an error the way the run was asked to: a JSON object on stdout under --json, text on
 * stderr otherwise. Returns the exit code.
 */
export const reportError: ReportErrorFn = (error, context) => {
    const report = describeError(error);

    if (context.json) {
        context.io.stdout.write(`${toJson(report, context.commandId)}\n`);
    } else {
        context.io.stderr.write(`${toText(report, context)}\n`);
    }

    return report.exitCode;
};
