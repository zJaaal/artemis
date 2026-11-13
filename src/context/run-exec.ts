import path from 'node:path';

import {
    EXEC_LOG_HINT_PREFIX,
    EXEC_ERROR_LINES,
    EXEC_FOLDER_ACCESS_HINT,
    EXEC_NOT_A_FOLDER_HINT,
    FOLDER_PROBLEM,
    EXEC_NO_LOG_HINT,
    EXEC_NOT_FOUND_HINT,
    EXEC_START_HINT,
    EXEC_TAIL_LINE_CHARS,
    EXEC_TAIL_LINES,
    ID_SEPARATOR
} from '../constants.js';
import { spawnChild, spawnDetached } from '../edges/exec.js';
import { CommandError, ExecError } from '../errors/errors.js';
import type {
    ChildStream,
    ExecMode,
    ExecDetachedOptions,
    ExecDetachedResult,
    ExecFn,
    ExecOptions,
    ExecResult,
    FolderProblem,
    ExecRun,
    SpawnOutcome
} from '../models.js';
import {
    assertExecOptions,
    createOutputKeeper,
    detachedPlannedLine,
    isDetachedOptions,
    pickExecMode,
    timeoutText
} from './exec.js';

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

/** Why a child cannot run in its folder, with what to do about it; the folder is always named. */
function folderError(command: string, problem: FolderProblem, cwd: string): CommandError {
    switch (problem) {
        case FOLDER_PROBLEM.MISSING:
            return new CommandError(`The folder ${cwd} does not exist`, {
                hint: `Create it, or check the cwd passed to ${command}.`
            });
        case FOLDER_PROBLEM.NOT_A_FOLDER:
            return new CommandError(`${cwd} is not a folder`, { hint: EXEC_NOT_A_FOLDER_HINT });
        case FOLDER_PROBLEM.NO_ACCESS:
            return new CommandError(`This user cannot enter the folder ${cwd}`, {
                hint: EXEC_FOLDER_ACCESS_HINT
            });
    }
}

/** The error for a child that never started: a missing folder, a program that cannot run or is not there. */
export function startFailure(
    command: string,
    outcome: Pick<SpawnOutcome, 'cwdProblem' | 'startError' | 'notFound'>,
    cwd: string | undefined
): CommandError | undefined {
    if (outcome.cwdProblem !== undefined) {
        return folderError(command, outcome.cwdProblem, cwd ?? '');
    }

    if (outcome.startError !== undefined) {
        return new CommandError(`${command} could not be started: ${outcome.startError}`, {
            hint: EXEC_START_HINT
        });
    }

    // A program that never started is a failure even when the run stopped it first
    if (outcome.notFound) {
        return new CommandError(`${command} was not found`, { hint: EXEC_NOT_FOUND_HINT });
    }

    return undefined;
}

/** The error for a child that did not end well, with the last lines it printed. */
export function failure(
    run: ExecRun,
    command: string,
    outcome: SpawnOutcome,
    options: ExecOptions,
    lines: { tail: readonly string[]; errorLines: readonly string[] },
    cwd: string | undefined
): CommandError | undefined {
    const { tail, errorLines } = lines;
    const notStarted = startFailure(command, outcome, cwd);

    if (notStarted) {
        return notStarted;
    }

    // A child Artemis stopped itself (the run ended without awaiting it) is not a failure
    if (outcome.stopped) {
        return undefined;
    }

    const hidden = run.global.quiet || options.capture === true || options.readOnly === true;

    const base = {
        hint: failureHint(run),
        tail,
        showTail: hidden && !run.global.json,
        ...(errorLines.length ? { errorLines } : {})
    };

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

/** The folder a child runs in, as spawn sees it: what a missing-folder error has to name. */
const childCwd = (run: ExecRun, options: { cwd?: string | undefined }): string | undefined =>
    run.cwd === undefined ? options.cwd : path.resolve(run.cwd, options.cwd ?? '');

/** Under `--dry-run` a call that is not `readOnly` starts nothing: it adds itself to the plan. */
const isSkipped = (run: ExecRun, readOnly: boolean): boolean => run.global.dryRun && !readOnly;

/**
 * Starts a child that outlives the command (its own process group, its output appended to a file),
 * and resolves to its pid once it has spawned. Artemis does not track it: it is not in `run.children`,
 * so it is never killed when `run` ends.
 */
async function startDetached(
    run: ExecRun,
    command: string,
    args: readonly string[],
    options: ExecDetachedOptions
): Promise<ExecDetachedResult> {
    if (isSkipped(run, false)) {
        run.plan.push(detachedPlannedLine(command, args, options.logFile));

        return { pid: null, skipped: true };
    }

    const cwd = childCwd(run, options);

    const outcome = await spawnDetached({
        command,
        args,
        cwd,
        env: options.env,
        logFile: options.logFile
    });

    const error = startFailure(command, outcome, cwd);

    if (error || outcome.pid === undefined) {
        throw (
            error ?? new CommandError(`${command} could not be started`, { hint: EXEC_START_HINT })
        );
    }

    return { pid: outcome.pid, skipped: false };
}

/** Runs a child, waits for it and routes its output by the flags of the run. */
async function runChild(
    run: ExecRun,
    command: string,
    args: readonly string[],
    options: ExecOptions
): Promise<ExecResult> {
    const readOnly = options.readOnly === true;

    if (isSkipped(run, readOnly)) {
        run.plan.push(plannedLine(command, args, options.cwd));

        return { code: 0, output: '', skipped: true };
    }

    const mode = pickExecMode({
        capture: options.capture === true || readOnly,
        quiet: run.global.quiet,
        json: run.global.json,
        log: run.log !== undefined,
        errorPattern: options.errorPattern !== undefined
    });

    const cwd = childCwd(run, options);

    const keeper = createOutputKeeper({
        tailLines: EXEC_TAIL_LINES,
        tailChars: EXEC_TAIL_LINE_CHARS,
        errorPattern: options.errorPattern,
        errorLines: EXEC_ERROR_LINES
    });

    // Only a caller that asked for the output gets it: a dev server under --log would grow this for hours
    const collect = options.capture === true || readOnly;
    let output = '';

    const child = spawnChild({
        command,
        args,
        cwd,
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
                keeper.push(stream, chunk);
            }
        }
    });

    run.children.add(child);

    try {
        const outcome = await child.done;
        const errorLines = keeper.errorLines();

        const error = failure(
            run,
            command,
            outcome,
            options,
            { tail: keeper.tail(), errorLines },
            cwd
        );

        if (error) {
            throw error;
        }

        return {
            code: outcome.code,
            output,
            skipped: false,
            // Lines are for a child that failed: a success (code 0) that printed a matching line has none
            ...(outcome.code !== 0 && errorLines.length ? { errorLines } : {})
        };
    } finally {
        run.children.delete(child);
    }
}

/** `ctx.exec` for any options: a bad call is a `TypeError` before anything else, a dry run included. */
async function execute(
    run: ExecRun,
    command: string,
    args: readonly string[],
    options: ExecOptions | ExecDetachedOptions
): Promise<ExecResult | ExecDetachedResult> {
    assertExecOptions(options);

    if (isDetachedOptions(options)) {
        return startDetached(run, command, args, options);
    }

    return runChild(run, command, args, options);
}

/**
 * `ctx.exec`. A call nobody awaits that fails on its own must not take the process down with an
 * unhandled rejection: whoever awaits still gets the error, and a run that does not look away
 * from the child is told by `run` ending, which stops it.
 */
export const createExec = (run: ExecRun): ExecFn => {
    function exec(
        command: string,
        args: readonly string[] | undefined,
        options: ExecDetachedOptions
    ): Promise<ExecDetachedResult>;
    function exec(
        command: string,
        args?: readonly string[],
        options?: ExecOptions
    ): Promise<ExecResult>;
    function exec(
        command: string,
        args: readonly string[] = [],
        options: ExecOptions | ExecDetachedOptions = {}
    ): Promise<ExecResult | ExecDetachedResult> {
        const result = execute(run, command, args, options);

        result.catch(() => undefined);

        return result;
    }

    return exec;
};
