import { MAX_SLOT_PORT, MIN_SLOT_PORT } from './constants.js';
import type { FindPortProblemsFn, PortOutOfRange, PortPlan } from './models.js';

// Pure: the checks on the base ports an app hands to `defineWorktrees`. They run once, when it is
// called, before any instance exists, so a mistake names its keys instead of surfacing as a Docker
// bind error several layers below it.

const isWholeNumberAbove0 = (value: number): boolean => Number.isInteger(value) && value > 0;

/** `slotStep` and `maxSlots` have to be whole numbers above 0, and every base a whole number. */
function numberProblems({ ports, slotStep, maxSlots }: PortPlan): string[] {
    const problems: string[] = [];

    if (!isWholeNumberAbove0(slotStep)) {
        problems.push(`slotStep must be a whole number greater than 0, but got ${slotStep}.`);
    }

    if (!isWholeNumberAbove0(maxSlots)) {
        problems.push(`maxSlots must be a whole number greater than 0, but got ${maxSlots}.`);
    }

    Object.entries(ports)
        .filter(([, base]) => !Number.isInteger(base))
        .forEach(([key, base]) =>
            problems.push(`ports.${key} must be a whole number, but got ${base}.`)
        );

    return problems;
}

/** The first slot whose port is outside the allowed range, or undefined. The port is linear in the slot, so the ends are enough. */
function outOfRange(base: number, { slotStep, maxSlots }: PortPlan): PortOutOfRange | undefined {
    if (base < MIN_SLOT_PORT || base > MAX_SLOT_PORT) {
        return { slot: 0, port: base };
    }

    const lastSlot = maxSlots - 1;

    if (base + lastSlot * slotStep <= MAX_SLOT_PORT) {
        return undefined;
    }

    const slot = Math.floor((MAX_SLOT_PORT - base) / slotStep) + 1;

    return { slot, port: base + slot * slotStep };
}

function rangeProblems(plan: PortPlan): string[] {
    return Object.entries(plan.ports).flatMap(([key, base]) => {
        const found = outOfRange(base, plan);

        return found
            ? [
                  `ports.${key} is ${found.port} in slot ${found.slot}, outside ${MIN_SLOT_PORT} to ${MAX_SLOT_PORT}: below ${MIN_SLOT_PORT} a port needs root, and from ${MAX_SLOT_PORT + 1} up the operating system may hand it to an outgoing connection.`
              ]
            : [];
    });
}

/** Every pair of keys in a group, in the order they were declared: each key with the ones after it, then the rest. */
function pairsOf(keys: readonly string[]): [string, string][] {
    const [first, ...rest] = keys;

    return first === undefined
        ? []
        : [...rest.map((second): [string, string] => [first, second]), ...pairsOf(rest)];
}

/** Keys grouped by `base % slotStep`: only bases in the same group can ever share a port. */
function groupByRemainder(ports: Record<string, number>, slotStep: number): string[][] {
    const groups = new Map<number, string[]>();

    Object.entries(ports).forEach(([key, base]) => {
        const remainder = base % slotStep;

        groups.set(remainder, [...(groups.get(remainder) ?? []), key]);
    });

    return [...groups.values()];
}

/** One line for a pair that can meet: which slot of the lower base is which slot of the higher. */
function pairLine(plan: PortPlan, first: string, second: string): string | undefined {
    const a = plan.ports[first] ?? 0;
    const b = plan.ports[second] ?? 0;
    const distance = Math.abs(a - b) / plan.slotStep;
    const label = `${first} (${a}) and ${second} (${b})`;

    if (distance >= plan.maxSlots) {
        return undefined;
    }

    if (distance === 0) {
        return `  ${label}: share a port in every slot.`;
    }

    const [lower, higher] = a <= b ? [first, second] : [second, first];

    return `  ${label}: slot N + ${distance} of ${lower} is slot N of ${higher}.`;
}

function collisionProblems(plan: PortPlan): string[] {
    const order = new Map(Object.keys(plan.ports).map((key, index) => [key, index]));
    const indexOf = (key: string): number => order.get(key) ?? 0;

    const lines = groupByRemainder(plan.ports, plan.slotStep)
        .flatMap(pairsOf)
        .sort(([a1, a2], [b1, b2]) => indexOf(a1) - indexOf(b1) || indexOf(a2) - indexOf(b2))
        .map(([first, second]) => pairLine(plan, first, second))
        .filter((line): line is string => line !== undefined);

    if (!lines.length) {
        return [];
    }

    return [
        `Port bases that share ports across slots (slotStep ${plan.slotStep}, maxSlots ${plan.maxSlots}):`,
        ...lines,
        `Bases a multiple of slotStep apart share ports. Move one base of each pair so the two are not a multiple of ${plan.slotStep} apart, or ${plan.maxSlots} or more slots apart.`
    ];
}

/**
 * The problems with a port plan, as lines: a number that is not a whole number above 0, a port in
 * some slot outside 1024 to 49151, and every pair of bases that meet below `maxSlots`. The pairs
 * are listed together, in declaration order, so an app with several mistakes fixes them in one round.
 * Nothing about collisions is said when a number is wrong: the arithmetic would mean nothing.
 */
export const findPortProblems: FindPortProblemsFn = (plan) => {
    const numbers = numberProblems(plan);

    if (numbers.length) {
        return numbers;
    }

    return [...rangeProblems(plan), ...collisionProblems(plan)];
};
