import { describe, expect, test } from 'vitest';

import { checkRange, parseVersion } from './semver.js';

describe('parseVersion', () => {
    test('reads three numbers', () => {
        expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    });

    test.each([
        { name: 'a prerelease', text: '1.2.3-beta.1' },
        { name: 'build metadata', text: '1.2.3+build' },
        { name: 'two numbers', text: '1.2' },
        { name: 'four numbers', text: '1.2.3.4' },
        { name: 'a word', text: 'latest' }
    ])('$name is not a version', ({ text }) => {
        expect(parseVersion(text)).toBeUndefined();
    });
});

describe('checkRange: exact', () => {
    test('the same version is satisfied', () => {
        expect(checkRange('1.2.3', '1.2.3')).toBe('satisfied');
    });

    test('another version is not', () => {
        expect(checkRange('1.2.4', '1.2.3')).toBe('unsatisfied');
    });

    test('a leading v is stripped', () => {
        expect(checkRange('1.2.3', 'v1.2.3')).toBe('satisfied');
    });

    test('a leading = is stripped', () => {
        expect(checkRange('1.2.3', '=1.2.3')).toBe('satisfied');
    });
});

describe('checkRange: caret', () => {
    test('^1.2.3 accepts a later minor', () => {
        expect(checkRange('1.9.0', '^1.2.3')).toBe('satisfied');
    });

    test('^1.2.3 refuses the next major', () => {
        expect(checkRange('2.0.0', '^1.2.3')).toBe('unsatisfied');
    });

    test('^1.2.3 refuses an earlier version', () => {
        expect(checkRange('1.2.2', '^1.2.3')).toBe('unsatisfied');
    });

    test('^0.1.2 accepts a later patch', () => {
        expect(checkRange('0.1.9', '^0.1.2')).toBe('satisfied');
    });

    test('^0.1.2 refuses 0.2.0: on 0.x the caret pins the minor', () => {
        expect(checkRange('0.2.0', '^0.1.2')).toBe('unsatisfied');
    });

    test('^0.0.3 refuses 0.0.4: it pins the patch', () => {
        expect(checkRange('0.0.4', '^0.0.3')).toBe('unsatisfied');
    });

    test('^0.0.3 accepts 0.0.3', () => {
        expect(checkRange('0.0.3', '^0.0.3')).toBe('satisfied');
    });

    test('^1 means >=1.0.0 <2.0.0', () => {
        expect(checkRange('1.9.9', '^1')).toBe('satisfied');
    });

    test('^1 refuses 2.0.0', () => {
        expect(checkRange('2.0.0', '^1')).toBe('unsatisfied');
    });

    test('^1.2 refuses 1.1.0', () => {
        expect(checkRange('1.1.0', '^1.2')).toBe('unsatisfied');
    });

    test('^0 accepts every 0.x', () => {
        expect(checkRange('0.9.0', '^0')).toBe('satisfied');
    });

    test('^0 refuses 1.0.0', () => {
        expect(checkRange('1.0.0', '^0')).toBe('unsatisfied');
    });

    test('^0.0 refuses 0.1.0', () => {
        expect(checkRange('0.1.0', '^0.0')).toBe('unsatisfied');
    });
});

describe('checkRange: tilde', () => {
    test('~1.2.3 accepts a later patch', () => {
        expect(checkRange('1.2.9', '~1.2.3')).toBe('satisfied');
    });

    test('~1.2.3 refuses the next minor', () => {
        expect(checkRange('1.3.0', '~1.2.3')).toBe('unsatisfied');
    });

    test('~1.2 is 1.2.x', () => {
        expect(checkRange('1.2.7', '~1.2')).toBe('satisfied');
    });

    test('~1 is 1.x', () => {
        expect(checkRange('1.9.0', '~1')).toBe('satisfied');
    });
});

describe('checkRange: comparisons', () => {
    test('>=1.2.3 accepts the same version', () => {
        expect(checkRange('1.2.3', '>=1.2.3')).toBe('satisfied');
    });

    test('>1.2.3 refuses the same version', () => {
        expect(checkRange('1.2.3', '>1.2.3')).toBe('unsatisfied');
    });

    test('<=1.2.3 accepts the same version', () => {
        expect(checkRange('1.2.3', '<=1.2.3')).toBe('satisfied');
    });

    test('<1.2.3 refuses the same version', () => {
        expect(checkRange('1.2.3', '<1.2.3')).toBe('unsatisfied');
    });

    test('a comparison against a partial version is not checked', () => {
        expect(checkRange('1.2.3', '>=1')).toBe('not-checked');
    });
});

describe('checkRange: wildcards and partials', () => {
    test.each([{ range: '*' }, { range: 'x' }, { range: 'X' }])(
        '$range accepts anything',
        ({ range }) => {
            expect(checkRange('3.4.5', range)).toBe('satisfied');
        }
    );

    test('1.x accepts 1.9.0', () => {
        expect(checkRange('1.9.0', '1.x')).toBe('satisfied');
    });

    test('1.x refuses 2.0.0', () => {
        expect(checkRange('2.0.0', '1.x')).toBe('unsatisfied');
    });

    test('1.2.x refuses 1.3.0', () => {
        expect(checkRange('1.3.0', '1.2.x')).toBe('unsatisfied');
    });

    test('1.2.* accepts 1.2.9', () => {
        expect(checkRange('1.2.9', '1.2.*')).toBe('satisfied');
    });

    test('the partial 1 means 1.x', () => {
        expect(checkRange('1.4.0', '1')).toBe('satisfied');
    });

    test('the partial 1.2 means 1.2.x', () => {
        expect(checkRange('1.2.5', '1.2')).toBe('satisfied');
    });
});

describe('checkRange: ||', () => {
    test('satisfied when either side is', () => {
        expect(checkRange('2.1.0', '^1.0.0 || ^2.0.0')).toBe('satisfied');
    });

    test('works without spaces around it', () => {
        expect(checkRange('2.1.0', '^1.0.0||^2.0.0')).toBe('satisfied');
    });

    test('unsatisfied when neither side is', () => {
        expect(checkRange('3.0.0', '^1.0.0 || ^2.0.0')).toBe('unsatisfied');
    });

    test('a side we do not understand makes the answer not checked when the rest fails', () => {
        expect(checkRange('3.0.0', '^1.0.0 || workspace:*')).toBe('not-checked');
    });

    test('but a side that is satisfied still wins', () => {
        expect(checkRange('1.5.0', '^1.0.0 || workspace:*')).toBe('satisfied');
    });
});

describe('checkRange: what is never checked', () => {
    test.each([
        { name: 'workspace:', range: 'workspace:*' },
        { name: 'file:', range: 'file:../artemis' },
        { name: 'link:', range: 'link:../artemis' },
        { name: 'a git URL', range: 'git+https://github.com/zJaaal/artemis.git' },
        { name: 'a tag', range: 'latest' },
        { name: 'a space-joined range', range: '>=1.0.0 <2.0.0' },
        { name: 'a hyphen range', range: '1.0.0 - 2.0.0' },
        { name: 'a range with a prerelease', range: '^1.0.0-beta.1' },
        { name: 'an empty range', range: '' }
    ])('$name is not checked', ({ range }) => {
        expect(checkRange('1.2.3', range)).toBe('not-checked');
    });

    test('a running prerelease is not checked against any range', () => {
        expect(checkRange('1.2.3-beta.1', '^1.0.0')).toBe('not-checked');
    });
});
