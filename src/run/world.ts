import { DEFAULT_COLOR_ENV } from '../constants.js';
import { currentProcess } from '../edges/process.js';
import { createStyle } from '../help/help.js';
import type { ResolveWorldFn } from '../models.js';

/** Works out where output goes, whether to color and whether prompts may show. */
export const resolveWorld: ResolveWorldFn = (options) => {
    const system = currentProcess();
    const io = { stdout: options.stdout ?? system.stdout, stderr: options.stderr ?? system.stderr };
    const env = options.env ?? system.env;
    const color = options.color ?? (Boolean(io.stdout.isTTY) && !env[DEFAULT_COLOR_ENV]);
    const canPrompt = options.interactive ?? (system.stdinIsTTY && system.stdoutIsTTY);

    return { io, bin: options.bin, style: createStyle(color), canPrompt };
};
