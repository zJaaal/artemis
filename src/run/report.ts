import { EXIT_CODE, FAILURE_CODES } from '../constants.js';
import { isCommandError, isExecError, isUsageError } from '../errors/errors.js';
import type { ErrorReport, FailureCodeOfFn, ReportContext, ReportErrorFn } from '../models.js';
import { messageOf } from '../utils/error-message.js';

/** The exit code of a tagged error, trusted only when it is a failure code: a failed run never exits 0. */
const failureCodeOf: FailureCodeOfFn = (value) =>
    FAILURE_CODES.find((code) => code === value) ?? EXIT_CODE.FAILED;

/** Splits an error into what the user sees; only a plain error (a bug) carries its stack. */
function describeError(error: unknown): ErrorReport {
    const isExpected = isCommandError(error);

    return {
        message: messageOf(error),
        hint: isExpected ? error.hint : undefined,
        usage: isUsageError(error) ? error.usage : undefined,
        stack: !isExpected && error instanceof Error ? error.stack : undefined,
        tail: isExecError(error) && error.tail.length ? error.tail : undefined,
        showTail: isExecError(error) && error.showTail,
        exitCode: isExpected ? failureCodeOf(error.exitCode) : EXIT_CODE.FAILED
    };
}

/** The failure envelope: the keys of spec 01, then `log` and `tail` when there are any. */
function toJson(report: ErrorReport, { commandId, log }: ReportContext): string {
    return JSON.stringify({
        ok: false,
        command: commandId ?? null,
        error: report.message,
        ...(report.hint ? { hint: report.hint } : {}),
        ...(log === undefined ? {} : { log }),
        ...(report.tail ? { tail: report.tail } : {})
    });
}

function toText(report: ErrorReport, { style }: ReportContext): string {
    const lines = [`${style.red('Error:')} ${report.message}`];

    if (report.hint) {
        lines.push(`${style.yellow('Hint:')} ${report.hint}`);
    }

    if (report.tail && report.showTail) {
        lines.push('', ...report.tail.map((line) => style.dim(line)));
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
        context.io.stdout.write(`${toJson(report, context)}\n`);
    } else {
        context.io.stderr.write(`${toText(report, context)}\n`);
    }

    return report.exitCode;
};
