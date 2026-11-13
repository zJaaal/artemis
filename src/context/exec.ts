import {
    CARRIAGE_RETURN,
    EXEC_DETACHED_KEYS,
    EXEC_DETACHED_NEEDS_LOGFILE,
    EXEC_LOGFILE_WITHOUT_DETACHED,
    EXEC_PIPED_HIDDEN,
    ID_SEPARATOR,
    LINE_END,
    MS_PER_SECOND
} from '../constants.js';
import type {
    AssertExecOptionsFn,
    ChildStream,
    CreateTailFn,
    DetachedPlannedLineFn,
    ExecDetachedOptions,
    IsDetachedOptionsFn,
    PickExecModeFn
} from '../models.js';

/**
 * How `ctx.exec` runs a child: the first row that applies, top to bottom. Output is piped only when
 * something needs the bytes, because a child that inherits the terminal keeps its colors and progress
 * bars. `--log` is not a mode of its own: it is a copy of every piped row.
 */
export const pickExecMode: PickExecModeFn = ({ capture, quiet, json, log }) => {
    if (capture || quiet) {
        return EXEC_PIPED_HIDDEN;
    }

    if (json) {
        // stdout must stay exactly one object, so the child's stdout goes to stderr too
        return { pipe: true, echo: 'stderr', keep: true };
    }

    return log
        ? { pipe: true, echo: 'split', keep: true }
        : { pipe: false, echo: 'none', keep: false };
};

/**
 * Keeps the last `maxLines` lines a child printed, each cut at `maxChars`. Lines are split per
 * stream, so a half-written line of one stream never glues onto the other. Blank lines are not kept:
 * the tail is for reading why a child failed, and they cost tokens.
 */
export const createTail: CreateTailFn = (maxLines, maxChars) => {
    const kept: string[] = [];
    const open: Record<ChildStream, string> = { stdout: '', stderr: '' };

    // A carriage return puts the cursor back at the start of the line: progress bars rewrite it, so
    // only what follows the last one is what the terminal shows (and what the tail is worth)
    const lastState = (text: string): string => text.slice(text.lastIndexOf('\r') + 1);

    const add = (line: string): void => {
        const clean = lastState(line.replace(CARRIAGE_RETURN, ''));

        if (clean.trim() === '') {
            return;
        }

        kept.push(clean.slice(0, maxChars));

        if (kept.length > maxLines) {
            kept.shift();
        }
    };

    return {
        push: (stream, chunk) => {
            const parts = `${open[stream]}${chunk}`.split(LINE_END);

            const partial = parts.pop() ?? '';
            const trailing = CARRIAGE_RETURN.test(partial) ? '\r' : '';

            // The half-written line is bounded too: a progress bar that never ends a line must not grow
            open[stream] =
                `${lastState(partial.slice(0, partial.length - trailing.length)).slice(0, maxChars)}${trailing}`;

            parts.forEach(add);
        },
        lines: () => {
            add(open.stdout);
            add(open.stderr);
            open.stdout = '';
            open.stderr = '';

            return [...kept];
        }
    };
};

/** How long a timeout was, as a person writes it: 1500 ms is "1.5 s", 30000 ms is "30 s". */
export const timeoutText = (timeoutMs: number): string => `${timeoutMs / MS_PER_SECOND} s`;

/** Whether the options are those of a detached call (`detached: true`). */
export const isDetachedOptions: IsDetachedOptionsFn = (options): options is ExecDetachedOptions =>
    'detached' in options && options.detached === true;

/** The options a call has, whatever their value: a key set to `undefined` is the same as no key. */
const setKeys = (options: object): string[] =>
    Object.entries(options).flatMap(([key, value]) => (value === undefined ? [] : [key]));

/**
 * A call that cannot be what it says is a `TypeError`, found before anything runs (a dry run
 * included): a detached call needs a `logFile` that is not empty and takes no option of a child that
 * is waited for, and `logFile` means nothing without `detached`.
 */
export const assertExecOptions: AssertExecOptionsFn = (options) => {
    const keys = setKeys(options);

    if (!isDetachedOptions(options)) {
        if (keys.includes('logFile')) {
            throw new TypeError(EXEC_LOGFILE_WITHOUT_DETACHED);
        }

        return;
    }

    if (typeof options.logFile !== 'string' || options.logFile === '') {
        throw new TypeError(EXEC_DETACHED_NEEDS_LOGFILE);
    }

    const stray = keys.find((key) => !EXEC_DETACHED_KEYS.includes(key));

    if (stray !== undefined) {
        throw new TypeError(`ctx.exec: "${stray}" does not go with detached: true`);
    }
};

/** What a dry run adds to the plan for a detached call it does not start. */
export const detachedPlannedLine: DetachedPlannedLineFn = (command, args, logFile) =>
    `start ${[command, ...args].join(ID_SEPARATOR)} in the background, output in ${logFile}`;
