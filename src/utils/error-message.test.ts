import { describe, expect, test } from 'vitest';

import { messageOf } from './error-message.js';

describe('messageOf', () => {
    test('is the message of an Error', () => {
        expect(messageOf(new Error('kaput'))).toBe('kaput');
    });

    test('is the value as text for anything else', () => {
        expect(messageOf(42)).toBe('42');
    });
});
