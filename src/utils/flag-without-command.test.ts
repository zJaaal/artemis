import { describe, expect, test } from 'vitest';

import { flagWithoutCommand } from './flag-without-command.js';

describe('flagWithoutCommand', () => {
    test('says there is no command for the flag', () => {
        expect(flagWithoutCommand('--log', 'art').message).toBe('There is no command for --log');
    });

    test('puts the binary in the hint', () => {
        expect(flagWithoutCommand('--log', 'art').hint).toBe(
            '--log goes with a command: art <command> --log'
        );
    });

    test('leaves the binary out when it is not known', () => {
        expect(flagWithoutCommand('--log', undefined).hint).toBe(
            '--log goes with a command: <command> --log'
        );
    });

    test('takes another subject', () => {
        expect(flagWithoutCommand('--log', 'art', 'help does not take').message).toBe(
            'help does not take --log'
        );
    });
});
