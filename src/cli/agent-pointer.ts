import path from 'node:path';

import {
    AGENTS_DOC_FILE,
    AGENTS_IMPORT,
    CRLF_EOL,
    GITIGNORE_FILE,
    LF_EOL,
    NEW_AGENTS_TITLE,
    POINTER_MARKER,
    POSIX_SEPARATOR
} from '../constants.js';
import { pointsOutside } from '../utils/points-outside.js';
import type {
    AppendedTextFn,
    GitignoreLineFn,
    InitStep,
    PlanPointerFn,
    PointerText
} from '../models.js';

// Pure: what `art init` adds so an agent that opens the project finds the commands, and so the
// audit files stay out of git. It only ever appends, or creates a file that is not there.

/** The pointer an agent reads: where to start, how to call, and where the rules for writing are. */
export const pointerText: PointerText = (bin) =>
    [
        '## Commands',
        '',
        `This project's commands run through \`${bin}\`. Start with \`npx ${bin} ${POINTER_MARKER}\`, call one with \`--json\`, and pass \`--dry-run\` before \`--yes\` on a destructive one. To write a new one: \`npx ${bin} help --authoring\`.`
    ].join(LF_EOL);

/** The line ending a file uses: CRLF when its first line ends with one. */
const eolOf = (text: string): string => {
    const [first = ''] = text.split(LF_EOL);

    return first.endsWith('\r') ? CRLF_EOL : LF_EOL;
};

/**
 * What to add to the end of a file: a newline first when it does not end with one, then one blank
 * line, then the text, in the file's own line ending. An empty file gets the text alone.
 */
export const appendedText: AppendedTextFn = (existing, addition) => {
    const eol = eolOf(existing);
    const separator = existing === '' ? '' : `${existing.endsWith(LF_EOL) ? '' : eol}${eol}`;

    return `${separator}${addition.split(LF_EOL).join(eol)}${eol}`;
};

/** The `.gitignore` line for the audit files, relative to the project; undefined when the state folder is outside it. */
export const gitignoreLine: GitignoreLineFn = (dir, stateDir) => {
    if (pointsOutside(stateDir, dir)) {
        return undefined;
    }

    const relative = path.relative(dir, stateDir);

    const folder = relative === '' ? '' : `/${relative.split(path.sep).join(POSIX_SEPARATOR)}`;

    return `${folder}/audit*.jsonl`;
};

const hasLine = (text: string, line: string): boolean =>
    text.split(LF_EOL).some((candidate) => candidate.trimEnd() === line);

/**
 * The files to append to or create: the pointer in AGENTS.md and in CLAUDE.md (unless that one
 * imports AGENTS.md, or either already has it), and the audit line in .gitignore. A file reached by
 * two names (a link) is written once. AGENTS.md is created only when it is not there and either no
 * CLAUDE.md exists or CLAUDE.md imports it.
 */
export const planPointer: PlanPointerFn = ({
    dir,
    bin,
    agents,
    claude,
    gitignore,
    gitignoreLine: line
}) => {
    const pointer = pointerText(bin);
    const steps: InitStep[] = [];
    const written = new Set<string>();

    const append = (file: { path: string; real: string; text: string }, text: string): void => {
        if (!written.has(file.real)) {
            written.add(file.real);

            steps.push({
                kind: 'file',
                mode: 'append',
                path: file.path,
                text: appendedText(file.text, text)
            });
        }
    };

    const claudeImports = claude !== undefined && AGENTS_IMPORT.test(claude.text);

    if (agents !== undefined && !agents.text.includes(POINTER_MARKER)) {
        append(agents, pointer);
    }

    if (agents === undefined && (claude === undefined || claudeImports)) {
        steps.push({
            kind: 'file',
            mode: 'create',
            path: path.join(dir, AGENTS_DOC_FILE),
            text: `${NEW_AGENTS_TITLE}${LF_EOL}${LF_EOL}${pointer}${LF_EOL}`
        });
    }

    if (claude !== undefined && !claudeImports && !claude.text.includes(POINTER_MARKER)) {
        append(claude, pointer);
    }

    if (line !== undefined && gitignore === undefined) {
        steps.push({
            kind: 'file',
            mode: 'create',
            path: path.join(dir, GITIGNORE_FILE),
            text: `${line}${LF_EOL}`
        });
    }

    if (line !== undefined && gitignore !== undefined && !hasLine(gitignore.text, line)) {
        append(gitignore, line);
    }

    return steps;
};
