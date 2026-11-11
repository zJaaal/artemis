import { PassThrough } from 'node:stream';

import type { FakeTty } from './models.js';

/**
 * A fake terminal for the prompts edge: a PassThrough that says it is a TTY and records raw mode.
 * The cast is the one place a PassThrough has to pass for a `ReadStream`: it has the members the
 * edge uses (`on`, `off`, `isTTY`, `setRawMode`), and the real stream is never needed in a test.
 */
export const createFakeTty = (): FakeTty => {
    const rawModes: boolean[] = [];
    const input = new PassThrough();
    const output = new PassThrough();

    const stdin = Object.assign(input, {
        isTTY: true,
        fd: 0 as const,
        setRawMode: (mode: boolean) => {
            rawModes.push(mode);

            return stdin;
        }
    });

    const stdout = Object.assign(output, { isTTY: true, fd: 1 as const });
    let written = '';

    output.on('data', (chunk: Buffer) => {
        written += chunk.toString();
    });

    return {
        stdin: stdin as unknown as FakeTty['stdin'],
        stdout: stdout as unknown as FakeTty['stdout'],
        type: (keys) => {
            input.write(keys);
        },
        rawModes,
        written: () => written,
        keypressListeners: () => input.listenerCount('keypress'),
        isPaused: () => input.isPaused()
    };
};
