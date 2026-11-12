import { CANCELLED_MESSAGE, DESTRUCTIVE_CONFIRM_HINT, DRY_RUN_FIRST_HINT } from '../constants.js';
import { createPrompter } from '../context/context.js';
import { CommandError } from '../errors/errors.js';
import type { ConfirmDestructiveFn, DestructivePlan, PlanDestructiveFn } from '../models.js';

/**
 * What to do before a command runs, from what it declares and how it was called. Under `--dry-run`
 * nothing is asked, because nothing will be changed; with `--yes` it runs; with someone to answer it
 * asks; otherwise it is refused.
 */
export const planDestructive: PlanDestructiveFn = (call) => {
    if (!call.destructive || call.dryRun || call.yes) {
        return 'run';
    }

    return call.interactive ? 'ask' : 'refuse';
};

const changesData = (bin: string, id: string): string => `${bin} ${id} changes or deletes data`;

/** The refusal for a destructive command nobody can confirm: says how to confirm, and how to preview. */
const refusal = (bin: string, id: string, supportsDryRun: boolean): CommandError =>
    new CommandError(changesData(bin, id), {
        hint: supportsDryRun
            ? `${DESTRUCTIVE_CONFIRM_HINT} ${DRY_RUN_FIRST_HINT}`
            : DESTRUCTIVE_CONFIRM_HINT
    });

/**
 * Enforces `destructive` before `run`: asks in a terminal, and needs `--yes` when nobody can answer.
 * Declining is a `CommandError` ("Cancelled."), exit 1.
 */
export const confirmDestructive: ConfirmDestructiveFn = async (call) => {
    const outcome: DestructivePlan = planDestructive(call);

    if (outcome === 'run') {
        return;
    }

    if (outcome === 'refuse') {
        throw refusal(call.bin, call.id, call.supportsDryRun);
    }

    const confirmed = await createPrompter({
        interactive: true,
        flagsSkipQuestions: false
    }).confirm(`${changesData(call.bin, call.id)} that cannot be recovered. Continue?`);

    if (!confirmed) {
        throw new CommandError(CANCELLED_MESSAGE);
    }
};
