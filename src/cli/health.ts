import {
    HEALTH_FAILING_RUNS,
    HEALTH_PREVIEW_RUNS,
    HEALTH_STALE_DAYS,
    MS_PER_DAY
} from '../constants.js';
import { FIX_SEPARATOR, LIST_SEPARATOR } from './constants.js';
import type { AuditLine, DoctorCheck, HealthChecksFn } from '../models.js';

// Pure: the checks of `art doctor` that read the audit trail. They are warnings, never a failure.

/** A run that really happened: the command ran, and it was not a dry run. */
const isRealRun = (entry: AuditLine): boolean => entry.ran && !entry.dryRun;

const isDryRun = (entry: AuditLine): boolean => entry.ran && entry.dryRun;

/** The lines of each command, in file order: one pass, so no check filters the whole trail per command. */
function groupByCommand(entries: readonly AuditLine[]): Map<string, AuditLine[]> {
    const groups = new Map<string, AuditLine[]>();

    entries.forEach((entry) => {
        const lines = groups.get(entry.command) ?? [];

        lines.push(entry);
        groups.set(entry.command, lines);
    });

    return groups;
}

/** Whether the last `HEALTH_FAILING_RUNS` real runs all failed (it takes that many real runs to say so). */
function isFailing(lines: readonly AuditLine[]): boolean {
    const real = lines.filter(isRealRun).slice(-HEALTH_FAILING_RUNS);

    return real.length === HEALTH_FAILING_RUNS && real.every((entry) => entry.exitCode !== 0);
}

/** Whether a destructive command was previewed enough times and never run for real. */
function isOnlyPreviewed(lines: readonly AuditLine[]): boolean {
    return lines.filter(isDryRun).length >= HEALTH_PREVIEW_RUNS && !lines.some(isRealRun);
}

/** Whether the newest line of a command is older than `HEALTH_STALE_DAYS`. */
function isStale(lines: readonly AuditLine[], now: number): boolean {
    const newest = Date.parse(lines.at(-1)?.time ?? '');

    return !Number.isNaN(newest) && now - newest > HEALTH_STALE_DAYS * MS_PER_DAY;
}

const warning = (
    id: DoctorCheck['id'],
    message: string,
    ids: readonly string[],
    fix: (id: string) => string
): DoctorCheck => ({
    id,
    status: 'warn',
    message: `${message}: ${ids.join(LIST_SEPARATOR)}`,
    fix: ids.map(fix).join(FIX_SEPARATOR)
});

/** A fix that says the same for every command still names the command it is for. */
const named = (id: string, text: string): string => `${id}: ${text}`;

/**
 * The health of the commands from the audit trail. A command that no longer exists is ignored (when
 * the commands could not be listed nothing is ignored). One check per kind names every command it
 * applies to; when nothing applies, one `ok` check says how many runs were looked at.
 */
export const healthChecks: HealthChecksFn = ({ history, loaded, now }) => {
    if (history.problem !== undefined) {
        return [
            {
                id: 'history',
                status: 'warn',
                message: history.problem,
                fix: 'Check the permissions of the state folder, or fix "artemis".stateDir in package.json.'
            }
        ];
    }

    const known = loaded === undefined ? undefined : new Set(loaded.map((command) => command.id));

    const destructive = new Set(
        loaded?.filter((command) => command.destructive).map((command) => command.id)
    );

    const entries = history.entries.filter(
        (entry) => known === undefined || known.has(entry.command)
    );

    if (!history.present || !entries.length) {
        return [{ id: 'history', status: 'ok', message: 'no history yet' }];
    }

    const groups = [...groupByCommand(entries).entries()];

    const idsWhere = (test: (id: string, lines: AuditLine[]) => boolean): string[] =>
        groups.filter(([id, lines]) => test(id, lines)).map(([id]) => id);

    const failing = idsWhere((_, lines) => isFailing(lines));
    const previewed = idsWhere((id, lines) => destructive.has(id) && isOnlyPreviewed(lines));
    const stale = idsWhere((_, lines) => isStale(lines, now));

    const checks: DoctorCheck[] = [
        ...(failing.length
            ? [
                  warning(
                      'history-failing',
                      `Failed in each of their last ${HEALTH_FAILING_RUNS} runs`,
                      failing,
                      (id) => `Run art history ${id} to see the errors.`
                  )
              ]
            : []),
        ...(previewed.length
            ? [
                  warning(
                      'history-previewed',
                      'Only ever previewed, never run for real',
                      previewed,
                      (id) =>
                          named(
                              id,
                              'Run it with --yes when the plan looks right, or delete it if it is not needed.'
                          )
                  )
              ]
            : []),
        ...(stale.length
            ? [
                  warning(
                      'history-stale',
                      `Not run for over ${HEALTH_STALE_DAYS} days`,
                      stale,
                      (id) => named(id, 'Delete the file if the command is no longer used.')
                  )
              ]
            : [])
    ];

    return checks.length
        ? checks
        : [
              {
                  id: 'history',
                  status: 'ok',
                  message: `no problems in the last ${entries.length} runs`
              }
          ];
};
