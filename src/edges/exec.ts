import { spawn } from 'node:child_process';
import fs from 'node:fs';

import {
    ERROR_CODE,
    EXEC_DRAIN_MS,
    EXEC_KILL_GRACE_MS,
    EXEC_OUTPUT_ENCODING,
    EXEC_STDIO_INHERITED,
    EXEC_STDIO_PIPED,
    EXIT_CODE
} from '../constants.js';
import type { ChildStream, SpawnChildFn, SpawnOutcome } from '../models.js';
import { codeOf } from '../utils/error-code.js';
import { messageOf } from '../utils/error-message.js';

// Edge: the only place a child process starts for `ctx.exec`. It never uses a shell, so nothing in
// `args` is interpreted, and it never lets the child it started outlive the call that asked for it (a grandchild the child started is
// its own business: only the direct child is signalled).

/** Starts a child. `done` resolves when it has ended; `stop` ends it politely, then for good. */
export const spawnChild: SpawnChildFn = (request) => {
    const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: request.pipe ? EXEC_STDIO_PIPED : EXEC_STDIO_INHERITED
    });

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
        const finish = (
            outcome: Pick<SpawnOutcome, 'code' | 'notFound' | 'cwdMissing'> & {
                startError?: string | undefined;
                signal?: string | undefined;
            }
        ) => {
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

            drainTimer = setTimeout(() => {
                child.stdout?.destroy();
                child.stderr?.destroy();

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
