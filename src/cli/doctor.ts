import path from 'node:path';

import { MANIFEST_FILE } from '../constants.js';
import type { DoctorCheck, DoctorFacts, DoctorFailureFn, RunDoctorFn } from '../models.js';
import { installedCheck, rangeCheck, rangeOf } from './install-checks.js';

// Pure: every check of `art doctor` from what the edges read. A `warn` or a `fail` always has a `fix`.

const SINGULAR_FAILED = '1 check failed';

const versionCheck = ({ running }: DoctorFacts): DoctorCheck => ({
    id: 'version',
    status: 'ok',
    message: `art ${running.version} (${running.root})`
});

const projectCheck = ({ project }: DoctorFacts): DoctorCheck =>
    project
        ? { id: 'project', status: 'ok', message: path.join(project.root, MANIFEST_FILE) }
        : {
              id: 'project',
              status: 'fail',
              message: 'No project found from this folder.',
              fix: 'Run art init in your project folder, or go to one.'
          };

const moduleCheck = ({ project }: DoctorFacts): DoctorCheck =>
    project?.manifest.type === 'module'
        ? { id: 'module', status: 'ok', message: '"type": "module" is set.' }
        : {
              id: 'module',
              status: 'warn',
              message: `${MANIFEST_FILE} does not say "type": "module". Command files are ES modules, so Node prints a warning for each one.`,
              fix: `Add "type": "module" to ${MANIFEST_FILE}.`
          };

function commandsCheck({ commands }: DoctorFacts): DoctorCheck {
    if (commands?.problem !== undefined) {
        return {
            id: 'commands',
            status: 'fail',
            message: commands.problem,
            fix: `Fix the "artemis" key in ${MANIFEST_FILE}.`
        };
    }

    if (commands === undefined || !commands.exists) {
        return {
            id: 'commands',
            status: 'fail',
            message: commands
                ? `The commands folder ${commands.dir} is not there.`
                : 'The commands folder is not there.',
            fix: `Create it, or set "artemis": { "commandsDir" } in ${MANIFEST_FILE}.`
        };
    }

    if (commands.warnings.length) {
        return {
            id: 'commands',
            status: 'fail',
            message: commands.warnings.join('; '),
            fix: 'Fix or remove the files listed, and rename an alias that is already taken.'
        };
    }

    return { id: 'commands', status: 'ok', message: `Every command in ${commands.dir} loads.` };
}

function wordsCheck({ hiddenWords }: DoctorFacts): DoctorCheck {
    if (!hiddenWords.length) {
        return { id: 'words', status: 'ok', message: 'No command hides a word of this binary.' };
    }

    return {
        id: 'words',
        status: 'warn',
        message: `A command or topic called ${hiddenWords.map((word) => `"${word}"`).join(', ')} is hidden by the word of this binary: it cannot be run through here.`,
        fix: hiddenWords
            .map((word) => `Rename commands/${word}.js; art ${word} runs the built-in.`)
            .join(' ')
    };
}

function stateCheck({ state }: DoctorFacts): DoctorCheck {
    if (state?.problem !== undefined) {
        return {
            id: 'state',
            status: 'warn',
            message: state.problem,
            fix: `Fix "artemis".stateDir in ${MANIFEST_FILE}.`
        };
    }

    if (state === undefined || !state.exists) {
        return { id: 'state', status: 'ok', message: 'No state folder yet.' };
    }

    if (!state.unreadable.length) {
        return {
            id: 'state',
            status: 'ok',
            message: `Every document in ${state.dir} can be read.`
        };
    }

    return {
        id: 'state',
        status: 'warn',
        message: state.unreadable.map(({ error }) => error).join('; '),
        fix: state.unreadable.map(({ name }) => `art state ${name} --reset`).join('; ')
    };
}

/**
 * Every check, in order. With no project only `version`, `installed` and `project` (which fails) are
 * reported: the others need one, and reporting them as failing would say nothing new.
 */
export const runDoctor: RunDoctorFn = (facts) => {
    const range = rangeOf(facts.project?.manifest ?? {});
    const install = { running: facts.running, range, local: facts.local };

    if (facts.project === undefined) {
        return [versionCheck(facts), installedCheck(install), projectCheck(facts)];
    }

    return [
        versionCheck(facts),
        rangeCheck(install),
        installedCheck(install),
        projectCheck(facts),
        moduleCheck(facts),
        commandsCheck(facts),
        wordsCheck(facts),
        stateCheck(facts)
    ];
};

/** What a doctor that found a failure says: "1 check failed" or "N checks failed", the first fix, every check. */
export const doctorFailure: DoctorFailureFn = (checks) => {
    const failed = checks.filter((check) => check.status === 'fail');

    if (!failed.length) {
        return undefined;
    }

    return {
        error: failed.length === 1 ? SINGULAR_FAILED : `${failed.length} checks failed`,
        hint: failed[0]?.fix,
        checks: [...checks]
    };
};
