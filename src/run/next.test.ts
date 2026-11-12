import { describe, expect, test } from 'vitest';

import { EXIT_CODE } from '../constants.js';
import { art, envelope } from '../test/art.js';

describe('run: ctx.next', () => {
    test('the lines go into the success envelope with the bin in front, once each, in order', async () => {
        expect(envelope(await art(['follows', '--json'])).next).toEqual([
            'art hello ana --json',
            'art math add 1 2'
        ]);
    });

    test('a tool published under its own name suggests its own name', async () => {
        const result = await art(['follows', '--json'], { bin: 'mytool' });

        expect(envelope(result).next?.[0]).toBe('mytool hello ana --json');
    });

    test('the key comes after result', async () => {
        expect(Object.keys(envelope(await art(['follows', '--json'])))).toEqual([
            'ok',
            'command',
            'result',
            'next'
        ]);
    });

    test('in text mode they are printed to stderr as Next: lines', async () => {
        expect((await art(['follows'])).err).toBe(
            'Next: art hello ana --json\nNext: art math add 1 2\n'
        );
    });

    test('--quiet hides the Next: lines', async () => {
        const run = await art(['follows', '--quiet']);

        expect(run.code).toBe(EXIT_CODE.OK);
        expect(run.err).toBe('');
    });

    test('--quiet does not remove them from the envelope', async () => {
        expect(envelope(await art(['follows', '--json', '--quiet'])).next).toHaveLength(2);
    });

    test('a failure carries no next', async () => {
        const result = envelope(await art(['follows-then-fails', '--json']));

        expect(result.ok).toBe(false);
        expect(result).not.toHaveProperty('next');
    });

    test('a failure prints no Next: line either', async () => {
        const run = await art(['follows-then-fails']);

        expect(run.code).toBe(EXIT_CODE.FAILED);
        expect(run.err).not.toMatch(/Next:/);
    });

    test('what an invoked command suggests is discarded', async () => {
        const result = envelope(await art(['invokes-follows', '--json']));

        expect(result.ok).toBe(true);
        expect(result).not.toHaveProperty('next');
    });

    test('a command that suggests nothing has no next key', async () => {
        const result = envelope(await art(['hello', '--json']));

        expect(result.ok).toBe(true);
        expect(result).not.toHaveProperty('next');
    });

    test('they are kept under --dry-run too', async () => {
        expect(envelope(await art(['dry-next', '--dry-run', '--json'])).next).toEqual([
            'art hello'
        ]);
    });
});
