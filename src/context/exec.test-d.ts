import { describe, expectTypeOf, test } from 'vitest';

import type { ExecDetachedResult, ExecFn, ExecResult } from '../models.js';

describe('ctx.exec types', () => {
    test('a plain call resolves to an ExecResult', () => {
        const call = (exec: ExecFn) => exec('git', ['status'], { capture: true });

        expectTypeOf(call).returns.toEqualTypeOf<Promise<ExecResult>>();
    });

    test('a call with no options resolves to an ExecResult', () => {
        const call = (exec: ExecFn) => exec('git');

        expectTypeOf(call).returns.toEqualTypeOf<Promise<ExecResult>>();
    });

    test('a detached call resolves to an ExecDetachedResult', () => {
        const call = (exec: ExecFn) =>
            exec('npm', ['run', 'dev'], { detached: true, logFile: 'dev.log' });

        expectTypeOf(call).returns.toEqualTypeOf<Promise<ExecDetachedResult>>();
    });

    test('a detached call without a logFile is a type error', () => {
        // @ts-expect-error detached needs a logFile
        const call = (exec: ExecFn) => exec('npm', [], { detached: true });

        expectTypeOf(call).toBeFunction();
    });

    test('a detached call with capture is a type error', () => {
        // @ts-expect-error detached takes no capture
        const call = (e: ExecFn) => e('n', [], { detached: true, logFile: 'a', capture: true });

        expectTypeOf(call).toBeFunction();
    });

    test('a logFile without detached is a type error', () => {
        // @ts-expect-error logFile only goes with detached
        const call = (exec: ExecFn) => exec('npm', [], { logFile: 'a' });

        expectTypeOf(call).toBeFunction();
    });

    test('the pid of a detached result is a number or null', () => {
        expectTypeOf<ExecDetachedResult['pid']>().toEqualTypeOf<number | null>();
    });
});
