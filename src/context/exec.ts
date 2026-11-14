import {
    CARRIAGE_RETURN,
    EXEC_DETACHED_KEYS,
    EXEC_DETACHED_NEEDS_LOGFILE,
    EXEC_ERROR_LINE_BUFFER_CHARS,
    EXEC_LOGFILE_WITHOUT_DETACHED,
    EXEC_PIPED_HIDDEN,
    EXEC_PIPED_SHOWN,
    EXEC_PATTERN_STATEFUL,
    EXEC_PATTERN_STATEFUL_FLAGS,
    ID_SEPARATOR,
    LINE_END,
    MS_PER_SECOND
} from '../constants.js';
import type {
    AssertExecOptionsFn,
    ChildStream,
    CreateErrorLinesFn,
    CreateLineReaderFn,
    CreateOutputKeeperFn,
    DetachedPlannedLineFn,
    ExecDetachedOptions,
    ExecOptions,
    IsDetachedOptionsFn,
    PickExecModeFn
} from '../models.js';

/**
 * How `ctx.exec` runs a child: the first row that applies, top to bottom. Output is piped only when
 * something needs the bytes, because a child that inherits the terminal keeps its colors and progress
 * bars. `--log` is not a mode of its own: it is a copy of every piped row.
 */
export const pickExecMode: PickExecModeFn = ({ capture, quiet, json, log, errorPattern }) => {
    if (capture || quiet) {
        return EXEC_PIPED_HIDDEN;
    }

    if (json) {
        // stdout must stay exactly one object, so the child's stdout goes to stderr too
        return { pipe: true, echo: 'stderr', keep: true };
    }

    // A child shown to the terminal is not read at all: `errorPattern` needs its lines, so it is piped
    // and shown stream by stream instead
    return log || errorPattern ? EXEC_PIPED_SHOWN : { pipe: false, echo: 'none', keep: false };
};

/**
 * Splits what a child printed into lines, per stream, so a half-written line of one stream never
 * glues onto the other. A carriage return puts the cursor back at the start of the line (progress
 * bars rewrite it), so only what follows the last one is the line. Blank lines are dropped. Every
 * line, and the half-written one while it grows, is bounded by `maxChars`: a progress line that
 * never ends must not grow without limit.
 */
export const createLineReader: CreateLineReaderFn = (maxChars, onLine) => {
    const open: Record<ChildStream, string> = { stdout: '', stderr: '' };

    const lastState = (text: string): string => text.slice(text.lastIndexOf('\r') + 1);

    const emit = (line: string): void => {
        const clean = lastState(line.replace(CARRIAGE_RETURN, ''));

        if (clean.trim() !== '') {
            onLine(clean.slice(0, maxChars));
        }
    };

    return {
        push: (stream, chunk) => {
            const parts = `${open[stream]}${chunk}`.split(LINE_END);

            const partial = parts.pop() ?? '';
            const trailing = CARRIAGE_RETURN.test(partial) ? '\r' : '';

            open[stream] =
                `${lastState(partial.slice(0, partial.length - trailing.length)).slice(0, maxChars)}${trailing}`;

            parts.forEach(emit);
        },
        flush: () => {
            emit(open.stdout);
            emit(open.stderr);
            open.stdout = '';
            open.stderr = '';
        }
    };
};

/**
 * Keeps the first `maxLines` lines that match a pattern, each cut at `maxChars` after matching. It
 * is fed whole lines (see `createOutputKeeper`), so a line far above the last 40 is found, and a long
 * one is matched before it is cut. The pattern is not stateful (no `g` or `y` flag), so `test` gives
 * the same answer for the same line.
 */
export const createErrorLines: CreateErrorLinesFn = (pattern, maxLines, maxChars) => {
    const kept: string[] = [];

    return {
        add: (line) => {
            if (kept.length < maxLines && pattern.test(line)) {
                kept.push(line.slice(0, maxChars));
            }
        },
        lines: () => [...kept]
    };
};

/**
 * What a failed child leaves behind, from one reader per stream: the last `tailLines` lines, each cut
 * at `tailChars` (a line that is blank is not kept: it costs tokens), and, with an `errorPattern`, the
 * first lines that match it, tested whole. The reader keeps lines up to `EXEC_ERROR_LINE_BUFFER_CHARS`
 * with or without a pattern, so the tail never depends on whether there is one.
 */
export const createOutputKeeper: CreateOutputKeeperFn = (options) => {
    const { tailLines, tailChars, errorPattern, errorLines } = options;
    const ring: string[] = [];

    const matcher =
        errorPattern === undefined
            ? undefined
            : createErrorLines(errorPattern, errorLines, tailChars);

    const reader = createLineReader(EXEC_ERROR_LINE_BUFFER_CHARS, (line) => {
        ring.push(line.slice(0, tailChars));

        if (ring.length > tailLines) {
            ring.shift();
        }

        matcher?.add(line);
    });

    return {
        push: reader.push,
        tail: () => {
            reader.flush();

            return [...ring];
        },
        errorLines: () => {
            reader.flush();

            return matcher?.lines() ?? [];
        }
    };
};

/** How long a timeout was, as a person writes it: 1500 ms is "1.5 s", 30000 ms is "30 s". */
export const timeoutText = (timeoutMs: number): string => `${timeoutMs / MS_PER_SECOND} s`;

/** Whether the options are those of a detached call (`detached: true`). */
export const isDetachedOptions: IsDetachedOptionsFn = (options): options is ExecDetachedOptions =>
    'detached' in options && options.detached === true;

/** Whether the options carry an `errorPattern` with the `g` or `y` flag. */
const hasStatefulPattern = (options: ExecOptions): boolean =>
    options.errorPattern !== undefined &&
    EXEC_PATTERN_STATEFUL_FLAGS.some((flag) => options.errorPattern?.flags.includes(flag));

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

        if (hasStatefulPattern(options)) {
            throw new TypeError(EXEC_PATTERN_STATEFUL);
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
