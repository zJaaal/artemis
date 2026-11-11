import { describe, expect, test } from 'vitest';

import { beforeTerminator } from './terminator.js';

describe('beforeTerminator', () => {
    test('keeps only the words before --', () => {
        expect(beforeTerminator(['echo', '--json', '--', '--json'])).toEqual(['echo', '--json']);
    });

    test('keeps everything when there is no --', () => {
        expect(beforeTerminator(['echo', 'hi'])).toEqual(['echo', 'hi']);
    });

    test('is empty when the line starts with --', () => {
        expect(beforeTerminator(['--', 'a'])).toEqual([]);
    });
});
