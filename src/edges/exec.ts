import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import { Socket } from 'node:net';
import path from 'node:path';

import {
    ERROR_CODE,
    EXEC_DETACHED_LOG_MODE,
    EXEC_DETACHED_STDIN,
    EXEC_DRAIN_MS,
    EXEC_KILL_GRACE_MS,
    EXEC_OUTPUT_ENCODING,
    EXEC_STDIO_INHERITED,
    EXEC_STDIO_PIPED,
    EXIT_CODE,
    LOG_FILE_HINT
} from '../constants.js';
import { CommandError } from '../errors/errors.js';
import type {
    ChildHandle,
    ChildStream,
    SpawnChildFn,
    SpawnDetachedFn,
    SpawnFinish,
    SpawnOutcome
} from '../models.js';
import { codeOf } from '../utils/error-code.js';
import { messageOf } from '../utils/error-message.js';

// Edge: the only place a child process starts for `ctx.exec`. It never uses a shell, so nothing in
// `args` is interpreted, and it never lets the child it started outlive the call that asked for it (a grandchild the child started is
// its own business: only the direct child is signalled).

/** The handle of a child that never started: it is already over, and there is nothing to stop. */
const notStarted = (error: unknown): ChildHandle => ({
    done: Promise.resolve<SpawnOutcome>({
        code: EXIT_CODE.FAILED,
        timedOut: false,
        notFound: false,
        cwdMissing: false,
        stopped: false,
        startError: messageOf(error),
        signal: undefined
    }),
    stop: () => Promise.resolve()
});

/** Starts a child. `done` resolves when it has ended; `stop` ends it politely, then for good. */
export const spawnChild: SpawnChildFn = (request) => {
    let child: ChildProcess;

    try {
        child = spawn(request.command, [...request.args], {
            cwd: request.cwd,
            env: request.env,
            shell: false,
            stdio: request.pipe ? EXEC_STDIO_PIPED : EXEC_STDIO_INHERITED
        });
    } catch (error) {
        // `spawn` throws at once for a few errors (a cwd that is a file, a null byte in an argument)
        return notStarted(error);
    }

    let ended = false;
    let timedOut = false;
    let stopped = false;
    let exited = false;
    let spawned = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;

    child.once('spawn', () => {
        spawned = true;
    });

    const done = new Promise<SpawnOutcome>((resolve) => {
        const finish = (outcome: SpawnFinish) => {
            ended = true;
            clearTimeout(killTimer);
            clearTimeout(timeoutTimer);
            clearTimeout(drainTimer);
            resolve({ startError: undefined, signal: undefined, ...outcome, timedOut, stopped });
        };

        // 'error' fires when the executable cannot start; 'close' never does then. Node gives the
        // same ENOENT for a missing program and a missing folder, so a missing cwd is not "not found".
        child.on('error', (error) => {
            // 'error' also fires when a signal cannot be delivered (EPERM): the child is then still running
            if (spawned) {
                return;
            }

            const cwdMissing = request.cwd !== undefined && !fs.existsSync(request.cwd);
            const notFound = codeOf(error) === ERROR_CODE.MISSING && !cwdMissing;

            finish({
                code: EXIT_CODE.FAILED,
                notFound,
                cwdMissing,
                startError: notFound || cwdMissing ? undefined : messageOf(error)
            });
        });

        // A child ended by a signal has no code: that is a failure
        child.on('close', (code, signal) =>
            finish({
                code: code ?? EXIT_CODE.FAILED,
                notFound: false,
                cwdMissing: false,
                signal: signal ?? undefined
            })
        );

        // 'close' waits for every process that shares the child's output pipes, so a grandchild
        // (`npm run dev`) that outlives the child would hang the call. 'exit' is the child itself:
        // its pipes get a short moment to drain, then they are cut.
        child.on('exit', (code, signal) => {
            exited = true;
            // The child ended in time: a timeout that fires while its output drains is not a timeout
            clearTimeout(timeoutTimer);

            drainTimer = setTimeout(() => {
                // Not destroyed: a closed pipe would kill a grandchild (a dev server) on its next write.
                // The pipes stay open and are read and thrown away, and do not keep Artemis alive.
                for (const source of [child.stdout, child.stderr]) {
                    source?.removeAllListeners('data');
                    source?.resume();

                    if (source instanceof Socket) {
                        source.unref();
                    }
                }

                finish({
                    code: code ?? EXIT_CODE.FAILED,
                    notFound: false,
                    cwdMissing: false,
                    signal: signal ?? undefined
                });
            }, EXEC_DRAIN_MS);
        });
    });

    const listen = (stream: ChildStream) => {
        const source = child[stream];

        source?.setEncoding(EXEC_OUTPUT_ENCODING);
        source?.on('data', (chunk: string) => request.onData(chunk, stream));
    };

    listen('stdout');
    listen('stderr');

    const stop = async (): Promise<void> => {
        if (ended) {
            return;
        }

        // A child that already ended on its own, with output still being read, did not end because of this
        stopped ||= !timedOut && !exited;
        child.kill('SIGTERM');

        killTimer ??= setTimeout(
            () => child.kill('SIGKILL'),
            request.killGraceMs ?? EXEC_KILL_GRACE_MS
        );

        await done;
    };

    if (request.timeoutMs !== undefined) {
        timeoutTimer = setTimeout(() => {
            timedOut = true;

            void stop();
        }, request.timeoutMs);
    }

    return { done, stop };
};

/** The descriptor of the log file a detached child writes to: opened for append, folders created first. */
function openDetachedLog(logFile: string, cwd: string | undefined): number {
    const target = path.resolve(cwd ?? '', logFile);

    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });

        return fs.openSync(target, EXEC_DETACHED_LOG_MODE);
    } catch (error) {
        throw new CommandError(`Cannot open the log file ${target}: ${messageOf(error)}`, {
            hint: LOG_FILE_HINT
        });
    }
}

const NOT_STARTED = { pid: undefined, notFound: false, cwdMissing: false } as const;

/**
 * Starts a child that outlives the call: its own process group, no stdin, stdout and stderr appended
 * to a file, and the parent lets go of it (`unref`), so Artemis can exit while it runs. It resolves
 * once the child has spawned (with its pid) or could not start. A folder that does not exist fails
 * before any folder of the log is created.
 */
export const spawnDetached: SpawnDetachedFn = (request) => {
    if (request.cwd !== undefined && !fs.existsSync(request.cwd)) {
        return Promise.resolve({ ...NOT_STARTED, cwdMissing: true, startError: undefined });
    }

    const descriptor = openDetachedLog(request.logFile, request.cwd);

    return new Promise((resolve) => {
        const fail = (startError: string | undefined, notFound: boolean): void => {
            fs.closeSync(descriptor);
            resolve({ ...NOT_STARTED, notFound, startError });
        };

        try {
            const child = spawn(request.command, [...request.args], {
                cwd: request.cwd,
                env: request.env,
                shell: false,
                detached: true,
                windowsHide: true,
                stdio: [EXEC_DETACHED_STDIN, descriptor, descriptor]
            });

            // After the spawn, an 'error' (a signal that cannot be delivered) is nobody's to handle: the
            // child is on its own, and an unhandled 'error' event would take the process down
            child.on('error', (error) => {
                if (child.pid === undefined) {
                    fail(
                        codeOf(error) === ERROR_CODE.MISSING ? undefined : messageOf(error),
                        codeOf(error) === ERROR_CODE.MISSING
                    );
                }
            });

            child.once('spawn', () => {
                child.unref();
                fs.closeSync(descriptor);
                resolve({ ...NOT_STARTED, pid: child.pid, startError: undefined });
            });
        } catch (error) {
            // `spawn` throws at once for a few errors (a cwd that is a file, a null byte in an argument)
            fail(messageOf(error), false);
        }
    });
};
