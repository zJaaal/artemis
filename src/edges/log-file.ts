import fs from 'node:fs';
import path from 'node:path';

import { LOG_FILE_HINT, LOG_FILE_OPEN_MODE, LOG_FLUSH_BYTES, LOG_FLUSH_MS } from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type { OpenLogFileFn } from '../models.js';
import { messageOf } from '../utils/error-message.js';

// Edge: the `--log` file. Opened once per run (truncated), appended to as things are printed and
// closed when the run ends, whatever the run did.

/** Opens (and truncates) the file; the path is relative to `cwd`. A file that cannot be opened is a CommandError. */
export const openLogFile: OpenLogFileFn = (file, cwd) => {
    const target = path.resolve(cwd, file);
    let descriptor: number;

    try {
        descriptor = fs.openSync(target, LOG_FILE_OPEN_MODE);
    } catch (error) {
        throw new CommandError(`Cannot open the log file ${target}: ${messageOf(error)}`, {
            hint: LOG_FILE_HINT
        });
    }

    let closed = false;
    let failed: string | undefined;
    let waiting = '';
    let timer: NodeJS.Timeout | undefined;

    // A write that fails (a full disk) must not crash a timer or replace the result of the run: the
    // first failure is kept, the rest of the log is dropped, and the run says so when it ends
    const attempt = (work: () => void): void => {
        try {
            work();
        } catch (error) {
            failed ??= messageOf(error);
            waiting = '';
        }
    };

    // One write per batch, not per chunk: a chatty child would otherwise block the event loop with a
    // syscall for every line, and delay the timers and pipe reads that `ctx.exec` depends on.
    const flush = () => {
        clearTimeout(timer);
        timer = undefined;

        if (waiting) {
            const text = waiting;

            waiting = '';
            attempt(() => fs.writeSync(descriptor, text));
        }
    };

    return {
        path: target,
        write: (text) => {
            if (closed || failed !== undefined) {
                return;
            }

            waiting += text;

            if (waiting.length >= LOG_FLUSH_BYTES) {
                flush();
            } else {
                timer ??= setTimeout(flush, LOG_FLUSH_MS).unref();
            }
        },
        close: () => {
            if (!closed) {
                flush();
                closed = true;
                attempt(() => fs.closeSync(descriptor));
            }
        },
        failure: () => failed
    };
};
