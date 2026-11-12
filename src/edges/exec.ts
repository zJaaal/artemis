import { spawn, type StdioOptions } from 'node:child_process';
import fs from 'node:fs';

import { ERROR_CODE, EXEC_DRAIN_MS, EXEC_KILL_GRACE_MS, EXIT_CODE } from '../constants.js';
import type { ChildStream, SpawnChildFn, SpawnOutcome } from '../models.js';
import { codeOf } from '../utils/error-code.js';

// Edge: the only place a child process starts for `ctx.exec`. It never uses a shell, so nothing in
// `args` is interpreted, and it never lets a child outlive the call that asked for it.

const STDIO_PIPED: StdioOptions = ['ignore', 'pipe', 'pipe'];
const STDIO_INHERITED: StdioOptions = 'inherit';
const OUTPUT_ENCODING = 'utf8';

/** Starts a child. `done` resolves when it has ended; `stop` ends it politely, then for good. */
export const spawnChild: SpawnChildFn = (request) => {
    const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: request.pipe ? STDIO_PIPED : STDIO_INHERITED
    });

    let ended = false;
    let timedOut = false;
    let stopped = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;

    const done = new Promise<SpawnOutcome>((resolve) => {
        const finish = (outcome: Pick<SpawnOutcome, 'code' | 'notFound' | 'cwdMissing'>) => {
            ended = true;
            clearTimeout(killTimer);
            clearTimeout(timeoutTimer);
            clearTimeout(drainTimer);
            resolve({ ...outcome, timedOut, stopped });
        };

        // 'error' fires when the executable cannot start; 'close' never does then. Node gives the
        // same ENOENT for a missing program and a missing folder, so a missing cwd is not "not found".
        child.on('error', (error) => {
            const cwdMissing = request.cwd !== undefined && !fs.existsSync(request.cwd);
            const notFound = codeOf(error) === ERROR_CODE.MISSING && !cwdMissing;

            finish({ code: EXIT_CODE.FAILED, notFound, cwdMissing });
        });

        // A child ended by a signal has no code: that is a failure
        child.on('close', (code) =>
            finish({ code: code ?? EXIT_CODE.FAILED, notFound: false, cwdMissing: false })
        );

        // 'close' waits for every process that shares the child's output pipes, so a grandchild
        // (`npm run dev`) that outlives the child would hang the call. 'exit' is the child itself:
        // its pipes get a short moment to drain, then they are cut.
        child.on('exit', (code) => {
            drainTimer = setTimeout(() => {
                child.stdout?.destroy();
                child.stderr?.destroy();
                finish({ code: code ?? EXIT_CODE.FAILED, notFound: false, cwdMissing: false });
            }, EXEC_DRAIN_MS);
        });
    });

    const listen = (stream: ChildStream) => {
        const source = child[stream];

        source?.setEncoding(OUTPUT_ENCODING);
        source?.on('data', (chunk: string) => request.onData(chunk, stream));
    };

    listen('stdout');
    listen('stderr');

    const stop = async (): Promise<void> => {
        if (ended) {
            return;
        }

        stopped ||= !timedOut;
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
