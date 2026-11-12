import {
    EXEC_LOG_HINT_PREFIX,
    EXEC_NO_LOG_HINT,
    EXEC_NOT_FOUND_HINT,
    EXEC_START_HINT,
    EXEC_TAIL_LINE_CHARS,
    EXEC_TAIL_LINES,
    ID_SEPARATOR
} from '../constants.js';
import { spawnChild } from '../edges/exec.js';
import { CommandError, ExecError } from '../errors/errors.js';
import type {
    ChildStream,
    ExecMode,
    ExecFn,
    ExecOptions,
    ExecResult,
    ExecRun,
    SpawnOutcome
} from '../models.js';
import { createTail, pickExecMode, timeoutText } from './exec.js';

/** What a dry run adds to the plan for a call it does not start: the command line, and where it would run. */
const plannedLine = (command: string, args: readonly string[], cwd: string | undefined): string => {
    const line = [command, ...args].join(ID_SEPARATOR);

    return cwd === undefined ? line : `${line} (in ${cwd})`;
};

/** Shows a chunk where the mode says: nowhere, on the stream it came from, or all on stderr. */
function echo(run: ExecRun, mode: ExecMode, chunk: string, stream: ChildStream): void {
    if (mode.echo === 'split') {
        run.io[stream].write(chunk);
    } else if (mode.echo === 'stderr') {
        run.io.stderr.write(chunk);
    }
}

const failureHint = (run: ExecRun): string =>
    run.log ? `${EXEC_LOG_HINT_PREFIX} ${run.log.path}` : EXEC_NO_LOG_HINT;

/** The error for a child that did not end well, with the last lines it printed. */
function failure(
    run: ExecRun,
    command: string,
    outcome: SpawnOutcome,
    options: ExecOptions,
    tail: readonly string[]
): CommandError | undefined {
    if (outcome.cwdMissing) {
        return new CommandError(`The folder ${options.cwd ?? ''} does not exist`, {
            hint: `Create it, or check the cwd passed to ${command}.`
        });
    }

    if (outcome.startError !== undefined) {
        return new CommandError(`${command} could not be started: ${outcome.startError}`, {
            hint: EXEC_START_HINT
        });
    }

    // A child Artemis stopped itself (the run ended without awaiting it) is not a failure
    if (outcome.stopped) {
        return undefined;
    }

    if (outcome.notFound) {
        return new CommandError(`${command} was not found`, { hint: EXEC_NOT_FOUND_HINT });
    }

    const hidden = run.global.quiet || options.capture === true || options.readOnly === true;
    const base = { hint: failureHint(run), tail, showTail: hidden && !run.global.json };

    if (outcome.timedOut) {
        const seconds = timeoutText(options.timeoutMs ?? 0);

        return new ExecError(`${command} took longer than ${seconds}`, base);
    }

    if (outcome.code !== 0 && options.reject !== false) {
        const how =
            outcome.signal === undefined
                ? `exited with code ${outcome.code}`
                : `was killed by ${outcome.signal}`;

        return new ExecError(`${command} ${how}`, base);
    }

    return undefined;
}

/**
 * `ctx.exec`: runs a child and routes its output by the flags of the run. Under `--dry-run` a call
 * that is not `readOnly` starts nothing: it adds itself to the plan and says it was skipped.
 */
export const createExec =
    (run: ExecRun): ExecFn =>
    async (
        command: string,
        args: readonly string[] = [],
        options: ExecOptions = {}
    ): Promise<ExecResult> => {
        const readOnly = options.readOnly === true;

        if (run.global.dryRun && !readOnly) {
            run.plan.push(plannedLine(command, args, options.cwd));

            return { code: 0, output: '', skipped: true };
        }

        const mode = pickExecMode({
            capture: options.capture === true || readOnly,
            quiet: run.global.quiet,
            json: run.global.json,
            log: run.log !== undefined
        });

        const tail = createTail(EXEC_TAIL_LINES, EXEC_TAIL_LINE_CHARS);
        // Only a caller that asked for the output gets it: a dev server under --log would grow this for hours
        const collect = options.capture === true || readOnly;
        let output = '';

        const child = spawnChild({
            command,
            args,
            cwd: options.cwd,
            env: options.env,
            pipe: mode.pipe,
            timeoutMs: options.timeoutMs,
            onData: (chunk, stream) => {
                if (collect) {
                    output += chunk;
                }

                echo(run, mode, chunk, stream);
                run.log?.write(chunk);

                if (mode.keep) {
                    tail.push(stream, chunk);
                }
            }
        });

        run.children.add(child);

        try {
            const outcome = await child.done;
            const error = failure(run, command, outcome, options, tail.lines());

            if (error) {
                throw error;
            }

            return { code: outcome.code, output, skipped: false };
        } finally {
            run.children.delete(child);
        }
    };
