import {
    ERROR_LINES_HEADING,
    EXIT_CODE,
    FAILURE_CODES,
    GLOBAL_FLAGS_TEXT,
    ID_SEPARATOR,
    USAGE_HINT_GLOBAL
} from '../constants.js';
import { isCommandError, isExecError, isUsageError } from '../errors/errors.js';
import type {
    ErrorReport,
    FailureCodeOfFn,
    FailureEnvelopeFn,
    ReportContext,
    PrintResultFn,
    ReportErrorFn,
    SuccessEnvelopeFn
} from '../models.js';
import { messageOf } from '../utils/error-message.js';

/** The exit code of a tagged error, trusted only when it is a failure code: a failed run never exits 0. */
const failureCodeOf: FailureCodeOfFn = (value) =>
    FAILURE_CODES.find((code) => code === value) ?? EXIT_CODE.FAILED;

/** Splits an error into what the user sees; only a plain error (a bug) carries its stack. */
function describeError(error: unknown): ErrorReport {
    const isExpected = isCommandError(error);
    const usage = isUsageError(error) ? error.usage : undefined;
    const ownHint = isExpected ? error.hint : undefined;

    // The error of a resolved command that has no hint of its own gets what is valid, in the hint
    const usageHint =
        isUsageError(error) &&
        error.fromCommand === true &&
        ownHint === undefined &&
        usage !== undefined;

    return {
        message: messageOf(error),
        hint: usageHint ? `${usage}. ${USAGE_HINT_GLOBAL} ${GLOBAL_FLAGS_TEXT}` : ownHint,
        usage: usageHint ? undefined : usage,
        usageHint,
        stack: !isExpected && error instanceof Error ? error.stack : undefined,
        tail: isExecError(error) && error.tail.length ? error.tail : undefined,
        errorLines: isExecError(error) && error.errorLines?.length ? error.errorLines : undefined,
        showTail: isExecError(error) && error.showTail,
        exitCode: isExpected ? failureCodeOf(error.exitCode) : EXIT_CODE.FAILED
    };
}

/** The success envelope, the one place it is built: the built-in words and `run()` all print it. */
export const successEnvelope: SuccessEnvelopeFn = (command, result, extras = {}) =>
    JSON.stringify({ ok: true, command, result, ...extras });

/** The one way a built-in word prints a success: the envelope under `--json`, the text otherwise. */
export const printResult: PrintResultFn = (io, { json, command, text, result, extras }) => {
    io.stdout.write(`${json ? successEnvelope(command, result, extras) : text}\n`);
};

/** The failure envelope, the one place it is built: `run()`'s errors and a failing `doctor` both print it. */
export const failureEnvelope: FailureEnvelopeFn = (command, error, keys = {}) =>
    JSON.stringify({
        ok: false,
        command,
        error,
        ...(keys.hint ? { hint: keys.hint } : {}),
        ...(keys.log === undefined ? {} : { log: keys.log }),
        ...(keys.tail ? { tail: keys.tail } : {}),
        ...(keys.errorLines ? { errorLines: keys.errorLines } : {}),
        ...(keys.checks ? { checks: keys.checks } : {})
    });

/** The failure envelope: the keys of spec 01, then `log` and `tail` when there are any. */
const toJson = (report: ErrorReport, { commandId, log }: ReportContext): string =>
    failureEnvelope(commandId ?? null, report.message, {
        hint: report.hint,
        log,
        tail: report.tail,
        errorLines: report.errorLines
    });

function toText(report: ErrorReport, { style, bin }: ReportContext): string {
    const lines = [`${style.red('Error:')} ${report.message}`];

    if (report.hint) {
        lines.push(`${style.yellow('Hint:')} ${report.hint}`);
    }

    if (report.errorLines && report.showTail) {
        lines.push(
            '',
            style.bold(ERROR_LINES_HEADING),
            ...report.errorLines.map((line) => style.dim(line))
        );
    }

    if (report.tail && report.showTail) {
        lines.push('', ...report.tail.map((line) => style.dim(line)));
    }

    if (report.usage) {
        lines.push(
            '',
            `${style.bold('Usage')}  ${bin === undefined ? '' : `${bin}${ID_SEPARATOR}`}${report.usage}`
        );
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
