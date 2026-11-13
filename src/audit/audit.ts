import {
    DRY_RUN_FLAG_TOKEN,
    GLOBAL_FLAG_TOKENS,
    LOG_FLAG,
    LOG_FLAG_PREFIX,
    NEWLINE,
    OPTION_TOKEN,
    RESERVED_FLAGS,
    TERMINATOR,
    YES_FLAG_TOKENS
} from '../constants.js';
import type {
    AuditLine,
    AuditArgvFn,
    ArgToken,
    BuildAuditLineFn,
    ParseAuditTextFn,
    StripGlobalFlagsFn
} from '../models.js';
import { isRecord } from '../utils/is-record.js';
import { beforeTerminator } from '../utils/terminator.js';

// Pure: the audit line of a run, and the lines of an audit file read back.

/** Whether a flag token is a global flag that stands alone (not `--log`, which takes a value). */
const isStandalone = (token: string): boolean =>
    token !== LOG_FLAG && GLOBAL_FLAG_TOKENS.includes(token);

/**
 * The words of a command line that did not parse, without the whole words that are a global flag:
 * `--json`, `-y`, `--log <file>`, `--log=<file>` and the like, with the value of `--log`. A group of
 * short flags (`-fy`) is never touched: without a parse nobody can say what it holds. After `--`
 * everything is a plain argument, and `--` itself stays.
 */
export const stripGlobalFlags: StripGlobalFlagsFn = (tokens) => {
    const kept: string[] = [];

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index] ?? '';

        if (token === TERMINATOR) {
            kept.push(...tokens.slice(index));

            break;
        }

        if (token === LOG_FLAG) {
            index++;
        } else if (!isStandalone(token) && !token.startsWith(LOG_FLAG_PREFIX)) {
            kept.push(token);
        }
    }

    return kept;
};

/**
 * The words of a command line that parsed, as typed, without the options the parser says are global
 * and the value word they took (`--log x.log`). A group that holds a global and something else
 * (`-fy`) stays as typed: the parser's own tokens say which words are whose, so a value that looks
 * like a flag (`-nyes`) is never taken for one. Pure.
 */
export const auditArgv: AuditArgvFn = (raw, tokens) => {
    const options = tokens.filter((token) => token.kind === OPTION_TOKEN);
    const isGlobal = (token: ArgToken): boolean => RESERVED_FLAGS.includes(token.name ?? '');

    const sharedWithOther = new Set(
        options.filter((token) => !isGlobal(token)).map((token) => token.index)
    );

    const dropped = options
        .filter((token) => isGlobal(token) && !sharedWithOther.has(token.index))
        .flatMap((token) =>
            token.inlineValue === false ? [token.index, token.index + 1] : [token.index]
        );

    const gone = new Set(dropped);

    return raw.filter((_, index) => !gone.has(index));
};

/** The audit line of a run: what was asked, whether the command ran, how it ended and how long it took. */
export const buildAuditLine: BuildAuditLineFn = (facts) => {
    const { draft, plan, error } = facts;
    const flags = beforeTerminator(draft.tokens);
    const dryRun = draft.global?.dryRun ?? flags.includes(DRY_RUN_FLAG_TOKEN);
    const yes = draft.global?.yes ?? YES_FLAG_TOKENS.some((token) => flags.includes(token));

    return {
        time: new Date(facts.startedAt).toISOString(),
        command: facts.commandId,
        argv: draft.argv ?? stripGlobalFlags(draft.tokens),
        ran: draft.ran,
        dryRun,
        yes,
        exitCode: facts.exitCode,
        ms: facts.endedAt - facts.startedAt,
        ...(dryRun ? { plan: [...plan] } : {}),
        ...(error === undefined ? {} : { error })
    };
};

/** Whether a parsed line has what every reader needs: when, which command, whether it ran. */
const isAuditLine = (value: unknown): value is AuditLine =>
    isRecord(value) &&
    typeof value.time === 'string' &&
    typeof value.command === 'string' &&
    typeof value.ran === 'boolean' &&
    typeof value.exitCode === 'number';

/** The lines of an audit file, in file order. A line that is not one is skipped and counted. */
export const parseAuditText: ParseAuditTextFn = (text) => {
    const entries: AuditLine[] = [];
    let skipped = 0;

    text.split(NEWLINE)
        .filter((line) => line.trim() !== '')
        .forEach((line) => {
            const parsed = parseJson(line);

            if (isAuditLine(parsed)) {
                entries.push(parsed);
            } else {
                skipped++;
            }
        });

    return { entries, skipped };
};

/** The value of a line of JSON, or undefined when it is not JSON. */
function parseJson(line: string): unknown {
    try {
        return JSON.parse(line);
    } catch {
        // A half-written or hand-edited line is skipped and counted by the reader, never an error
        return undefined;
    }
}
