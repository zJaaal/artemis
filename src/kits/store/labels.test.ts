import { describe, expect, test } from 'vitest';

import { LOCK_LABEL_MAX_LENGTH } from './constants.js';
import { assertLockLabel, holderOf } from './labels.js';

describe('holderOf', () => {
    test('reads the pid of a document lock, with no label', () => {
        expect(holderOf('4242 token-1')).toEqual({ pid: 4242 });
    });

    test('reads the label of a named lock: everything after the second space', () => {
        expect(holderOf('4242 token-1 build of core-feat-x')).toEqual({
            pid: 4242,
            label: 'build of core-feat-x'
        });
    });

    test('keeps the spaces inside a label', () => {
        expect(holderOf('4242 t a  b')).toMatchObject({ label: 'a  b' });
    });

    test('has no pid when the file holds none yet', () => {
        expect(holderOf('')).toEqual({ pid: undefined });
    });

    test('has no pid when the first word is not a number, and keeps the label', () => {
        expect(holderOf('? token build')).toEqual({ pid: undefined, label: 'build' });
    });

    test('reads only the pid from a lock written by the version before labels', () => {
        expect(holderOf('4242 token-1').pid).toBe(4242);
    });
});

describe('assertLockLabel', () => {
    test('accepts a label with spaces', () => {
        expect(() => assertLockLabel('build of core-feat-x')).not.toThrow();
    });

    test('accepts one of exactly the limit', () => {
        expect(() => assertLockLabel('x'.repeat(LOCK_LABEL_MAX_LENGTH))).not.toThrow();
    });

    test.each([
        { name: 'an empty string', label: '' },
        { name: 'a line break', label: 'a\nb' },
        { name: 'a carriage return', label: 'a\rb' },
        { name: 'one over the limit', label: 'x'.repeat(LOCK_LABEL_MAX_LENGTH + 1) },
        { name: 'a number', label: 5 },
        { name: 'undefined', label: undefined }
    ])('refuses $name with a TypeError', ({ label }) => {
        expect(() => assertLockLabel(label)).toThrow(TypeError);
    });
});
