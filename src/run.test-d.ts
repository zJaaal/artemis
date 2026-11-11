import { describe, expectTypeOf, test } from 'vitest';

import type { RunOptions } from './models.js';
import { run } from './run.js';

describe('run options', () => {
    test('bin is required: there is no "art" default', () => {
        expectTypeOf<RunOptions['bin']>().toEqualTypeOf<string>();
        // @ts-expect-error bin is missing
        void run([], { commandsDir: '/commands' });
    });

    test('run resolves to the exit code', () => {
        expectTypeOf(run).returns.resolves.toEqualTypeOf<number>();
    });
});
