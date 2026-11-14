import { describe, expect, test } from 'vitest';

import { markdownSection } from './markdown.js';

const DOC = [
    '# Title',
    '',
    '## First',
    'one',
    '',
    '```md',
    '## not a heading',
    '```',
    'still first',
    '',
    '## Second',
    'two',
    ''
].join('\n');

describe('markdownSection', () => {
    test('runs from its heading to the next ## heading', () => {
        expect(markdownSection(DOC, '## First')).toBe(
            '## First\none\n\n```md\n## not a heading\n```\nstill first'
        );
    });

    test('a ## inside a code fence does not end the section', () => {
        expect(markdownSection(DOC, '## First')).toContain('still first');
    });

    test('the last section runs to the end, without trailing blank lines', () => {
        expect(markdownSection(DOC, '## Second')).toBe('## Second\ntwo');
    });

    test('a heading that is only part of a line is not found', () => {
        expect(markdownSection(DOC, '## Fir')).toBeUndefined();
    });

    test('a missing heading is undefined', () => {
        expect(markdownSection(DOC, '## Third')).toBeUndefined();
    });
});
