import { describe, expect, test } from 'vitest';

import { UsageError } from '../errors/errors.js';
import { thrownBy } from '../test/thrown.js';
import { parseSkillWords } from './skill-words.js';

const NONE = { write: undefined, yes: false, json: false, help: false, quiet: false };

describe('parseSkillWords', () => {
    test('no words prints the skill', () => {
        expect(parseSkillWords([])).toEqual(NONE);
    });

    test('--write takes the next word as the path', () => {
        expect(parseSkillWords(['--write', 'a/SKILL.md']).write).toBe('a/SKILL.md');
    });

    test('--write=path works too', () => {
        expect(parseSkillWords(['--write=a/SKILL.md']).write).toBe('a/SKILL.md');
    });

    test.each([
        { flag: '--json', key: 'json' },
        { flag: '--yes', key: 'yes' },
        { flag: '-y', key: 'yes' },
        { flag: '--help', key: 'help' },
        { flag: '-h', key: 'help' },
        { flag: '--quiet', key: 'quiet' }
    ])('$flag sets $key', ({ flag, key }) => {
        expect(parseSkillWords([flag])).toMatchObject({ [key]: true });
    });

    test.each([
        { name: '--write with no path', words: ['--write'] },
        { name: 'an argument', words: ['now'] },
        { name: '--dry-run', words: ['--dry-run'] },
        { name: '--log', words: ['--log', 'x.log'] },
        { name: 'an unknown flag', words: ['--nope'] }
    ])('$name is a usage error', ({ words }) => {
        expect(thrownBy(() => parseSkillWords(words))).toBeInstanceOf(UsageError);
    });
});
