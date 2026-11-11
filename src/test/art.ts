import { run } from '../run.js';

import { COMMANDS_FIXTURE_DIR } from './constants.js';
import type { ArtResult, Envelope } from './models.js';
import type { RunOptions } from '../models.js';
import { createSink } from './sink.js';

export const TEST_BIN = 'art';

/** Runs the fixture CLI the way a test wants it: no prompts, no color, output captured. */
export const art = async (
    argv: string[],
    options: Partial<RunOptions> = {}
): Promise<ArtResult> => {
    const stdout = createSink();
    const stderr = createSink();

    const code = await run(argv, {
        bin: TEST_BIN,
        commandsDir: COMMANDS_FIXTURE_DIR,
        stdout,
        stderr,
        interactive: false,
        color: false,
        ...options
    });

    return { code, out: stdout.text, err: stderr.text };
};

/** The JSON envelope a command printed on stdout. */
export const envelope = (result: ArtResult): Envelope => JSON.parse(result.out) as Envelope;
