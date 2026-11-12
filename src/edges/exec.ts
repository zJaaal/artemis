import { spawn, type StdioOptions } from 'node:child_process';

import { ERROR_CODE, EXEC_KILL_GRACE_MS, EXIT_CODE } from '../constants.js';
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
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const done = new Promise<SpawnOutcome>((resolve) => {
        const finish = (outcome: Pick<SpawnOutcome, 'code' | 'notFound'>) => {
            ended = true;
            clearTimeout(killTimer);
            clearTimeout(timeoutTimer);
            resolve({ ...outcome, timedOut });
        };

        // 'error' fires when the executable cannot start; 'close' never does then
        child.on('error', (error) => {
            const notFound = codeOf(error) === ERROR_CODE.MISSING;

            finish({ code: EXIT_CODE.FAILED, notFound });
        });

        // A child ended by a signal has no code: that is a failure
        child.on('close', (code) => finish({ code: code ?? EXIT_CODE.FAILED, notFound: false }));
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
