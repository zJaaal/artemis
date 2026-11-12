import { describe, expect, test } from 'vitest';

import { MAX_SLOT_PORT, MIN_SLOT_PORT } from './constants.js';
import { findPortProblems } from './ports.js';

const DEFAULTS = { slotStep: 100, maxSlots: 20 };

const problemsOf = (ports: Record<string, number>, overrides: Partial<typeof DEFAULTS> = {}) =>
    findPortProblems({ ports, ...DEFAULTS, ...overrides });

describe('findPortProblems: bases that meet in two slots', () => {
    test('9200 and 9600 at step 100 meet 4 slots apart, and the message names both keys', () => {
        const [, line] = problemsOf({ elasticsearch: 9200, elasticsearchPerf: 9600 });

        expect(line).toBe(
            '  elasticsearch (9200) and elasticsearchPerf (9600): slot N + 4 of elasticsearch is slot N of elasticsearchPerf.'
        );
    });

    test('the message has a header with the step and the limit, and a closing rule', () => {
        const problems = problemsOf({ elasticsearch: 9200, elasticsearchPerf: 9600 });

        expect([problems[0], problems.at(-1)]).toEqual([
            'Port bases that share ports across slots (slotStep 100, maxSlots 20):',
            'Bases a multiple of slotStep apart share ports. Move one base of each pair so the two are not a multiple of 100 apart, or 20 or more slots apart.'
        ]);
    });

    test('the message suggests no particular port', () => {
        expect(problemsOf({ a: 9200, b: 9600 }).join('\n')).not.toMatch(/9650|e\.g\./);
    });

    test('9200 and 9650 pass', () => {
        expect(problemsOf({ elasticsearch: 9200, elasticsearchPerf: 9650 })).toEqual([]);
    });

    test('a custom slotStep is used: 9200 and 9600 pass at 300', () => {
        expect(problemsOf({ a: 9200, b: 9600 }, { slotStep: 300 })).toEqual([]);
    });

    test('and throw at 200, 2 slots apart', () => {
        expect(problemsOf({ a: 9200, b: 9600 }, { slotStep: 200 })[1]).toMatch(/slot N \+ 2 of a/);
    });

    test('two equal bases share a port in every slot', () => {
        expect(problemsOf({ a: 9200, b: 9200 })[1]).toBe(
            '  a (9200) and b (9200): share a port in every slot.'
        );
    });

    test('9200 and 4200 pass with the default limit: they are 50 slots apart', () => {
        expect(problemsOf({ a: 9200, b: 4200 })).toEqual([]);
    });

    test('and meet with maxSlots 51, at a distance of 50', () => {
        expect(problemsOf({ a: 9200, b: 4200 }, { maxSlots: 51 })[1]).toMatch(/slot N \+ 50 of b/);
    });

    test('the lower base is named first in the sentence, whatever the order of the keys', () => {
        expect(problemsOf({ high: 9600, low: 9200 })[1]).toMatch(
            /slot N \+ 4 of low is slot N of high/
        );
    });

    test('every pair is listed in one message, in the order the keys were declared', () => {
        const lines = problemsOf({ a: 9200, b: 9600, c: 8080, d: 8180, e: 9900 }).slice(1, -1);

        expect(lines.map((line) => line.trim().split(' ')[0])).toEqual(['a', 'a', 'b', 'c']);
    });

    test('three mistakes in one set are all listed', () => {
        const lines = problemsOf({ a: 9200, b: 9300, c: 9400 }).slice(1, -1);

        expect(lines).toHaveLength(3);
    });

    test('the scripts repo base set passes with the defaults', () => {
        const scripts = {
            http: 8080,
            https: 8443,
            postgres: 5432,
            elasticsearch: 9200,
            perf: 9650,
            frontend: 4200
        };

        expect(problemsOf(scripts)).toEqual([]);
    });
});

describe('findPortProblems: the range of a slot port', () => {
    test('a base below 1024 is refused in slot 0, naming the key and the port', () => {
        expect(problemsOf({ http: 80 })[0]).toMatch(/ports\.http is 80 in slot 0/);
    });

    test('a port past the top of the range in the top slot is refused, naming the slot', () => {
        const base = MAX_SLOT_PORT - 18 * DEFAULTS.slotStep;

        expect(problemsOf({ http: base })[0]).toMatch(/ports\.http is \d+ in slot 19/);
    });

    test('it names the lowest slot that leaves the range', () => {
        const base = MAX_SLOT_PORT - 5 * DEFAULTS.slotStep;

        expect(problemsOf({ http: base })[0]).toMatch(/in slot 6,/);
    });

    test('1024 is allowed', () => {
        expect(problemsOf({ http: MIN_SLOT_PORT })).toEqual([]);
    });

    test('49151 in the top slot is allowed', () => {
        expect(problemsOf({ http: MAX_SLOT_PORT - 19 * DEFAULTS.slotStep })).toEqual([]);
    });
});

describe('findPortProblems: numbers that are not whole numbers above 0', () => {
    test.each([
        {
            name: 'a slotStep of 0',
            plan: { slotStep: 0 },
            message: /slotStep must be a whole number/
        },
        {
            name: 'a negative slotStep',
            plan: { slotStep: -100 },
            message: /slotStep must be a whole number/
        },
        {
            name: 'a fractional slotStep',
            plan: { slotStep: 1.5 },
            message: /slotStep must be a whole number/
        },
        {
            name: 'a maxSlots of 0',
            plan: { maxSlots: 0 },
            message: /maxSlots must be a whole number/
        },
        {
            name: 'a negative maxSlots',
            plan: { maxSlots: -1 },
            message: /maxSlots must be a whole number/
        },
        {
            name: 'a fractional maxSlots',
            plan: { maxSlots: 2.5 },
            message: /maxSlots must be a whole number/
        }
    ])('$name is a problem', ({ plan, message }) => {
        expect(problemsOf({ http: 8080 }, plan)[0]).toMatch(message);
    });

    test('a base that is not a whole number names its key', () => {
        expect(problemsOf({ http: 8080.5 })[0]).toMatch(/ports\.http must be a whole number/);
    });

    test('says nothing about collisions when a number is wrong', () => {
        expect(problemsOf({ a: 9200, b: 9600 }, { slotStep: 0 })).toHaveLength(1);
    });
});
