import { describe, expect, test } from 'vitest';

import { isWithin, topicPrefixes } from './topics.js';

describe('isWithin', () => {
    test('a topic is within itself', () => {
        expect(isWithin('dotcms', 'dotcms')).toBe(true);
    });

    test('a command under the topic is within it, at any depth', () => {
        expect(isWithin('dotcms db seed', 'dotcms')).toBe(true);
    });

    test('a name that only starts like the topic is not within it', () => {
        expect(isWithin('dotcmsx start', 'dotcms')).toBe(false);
    });
});

describe('topicPrefixes', () => {
    test('a top-level command has none', () => {
        expect(topicPrefixes('hello')).toEqual([]);
    });

    test('lists every topic above a command, outermost first', () => {
        expect(topicPrefixes('dotcms db seed')).toEqual(['dotcms', 'dotcms db']);
    });
});
