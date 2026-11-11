import type { CurrentProcessFn } from '../models.js';

// Edge: the only place a run reads the real process, and only for what the caller did not pass.
export const currentProcess: CurrentProcessFn = () => ({
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY)
});
