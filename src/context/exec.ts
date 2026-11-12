import { CARRIAGE_RETURN, EXEC_PIPED_HIDDEN, LINE_END, MS_PER_SECOND } from '../constants.js';
import type { ChildStream, CreateTailFn, PickExecModeFn } from '../models.js';

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

    const add = (line: string): void => {
        const clean = line.replace(CARRIAGE_RETURN, '');

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

            open[stream] = parts.pop() ?? '';
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
