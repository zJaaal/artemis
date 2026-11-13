import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { FOLDER_PROBLEM } from '../constants.js';

import { CommandError } from '../errors/errors.js';
import { NO_EXECUTE_MODE, ROOT_UID, UNREADABLE_MODE } from '../test/constants.js';
import { withMode } from '../test/permissions.js';
import { createTempFolders } from '../test/temp.js';
import { spawnDetached } from './exec.js';

const folders = createTempFolders();

/** A folder that cannot be read is readable to root, so those tests do not apply there. */
const isRoot = process.getuid?.() === ROOT_UID;
const started: number[] = [];

/** A detached child is nobody's to stop but the test's: kill its whole group so none outlives the run. */
afterEach(() => {
    started.splice(0).forEach((pid) => {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch {
            // ESRCH: it is already gone, which is what the cleanup wanted
        }
    });

    folders.cleanUp();
});

const WRITE_WAIT_MS = 5000;
const POLL_MS = 20;
const SILENT_JOB = 'setInterval(() => {}, 1000)';

const PRINTING_JOB =
    "console.log('out line'); console.error('err line'); setInterval(() => {}, 1000)";

const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        // ESRCH: there is no such process any more
        return false;
    }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits (bounded) until the file holds something, so a test never depends on how fast a child writes. */
async function contentOf(file: string, wanted: number): Promise<string> {
    for (let waited = 0; waited < WRITE_WAIT_MS; waited += POLL_MS) {
        const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

        if (text.length >= wanted) {
            return text;
        }

        await sleep(POLL_MS);
    }

    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const start = async (script: string, logFile: string, cwd?: string) => {
    const outcome = await spawnDetached({
        command: process.execPath,
        args: ['-e', script],
        cwd,
        env: undefined,
        logFile
    });

    if (outcome.pid !== undefined) {
        started.push(outcome.pid);
    }

    return outcome;
};

describe('spawnDetached', () => {
    test('resolves with the pid of a child that keeps running', async () => {
        const { pid } = await start(SILENT_JOB, path.join(folders.make('artemis-det-'), 'a.log'));

        expect(pid !== undefined && isAlive(pid)).toBe(true);
    });

    test('its stdout and stderr are appended to the log file', async () => {
        const log = path.join(folders.make('artemis-det-'), 'a.log');

        await start(PRINTING_JOB, log);

        expect((await contentOf(log, 'out line\nerr line\n'.length)).split('\n').sort()).toEqual([
            '',
            'err line',
            'out line'
        ]);
    });

    test('the log is appended to, not truncated', async () => {
        const log = path.join(folders.make('artemis-det-'), 'a.log');

        fs.writeFileSync(log, 'before\n');
        await start(PRINTING_JOB, log);

        expect(await contentOf(log, 'before\nout line\n'.length)).toMatch(/^before\n/);
    });

    test('the folders of the log file are created', async () => {
        const log = path.join(folders.make('artemis-det-'), 'logs', 'deep', 'a.log');

        await start(SILENT_JOB, log);

        expect(fs.existsSync(log)).toBe(true);
    });

    test('a relative log file is resolved against the folder of the child', async () => {
        const cwd = folders.make('artemis-det-');

        await start(SILENT_JOB, 'out/a.log', cwd);

        expect(fs.existsSync(path.join(cwd, 'out', 'a.log'))).toBe(true);
    });

    test('it runs in its own process group', async () => {
        const { pid } = await start(SILENT_JOB, path.join(folders.make('artemis-det-'), 'a.log'));

        expect(() => process.kill(-(pid ?? 0), 0)).not.toThrow();
    });

    test('a program that is not there is reported as not found', async () => {
        const outcome = await spawnDetached({
            command: 'artemis-no-such-program',
            args: [],
            cwd: undefined,
            env: undefined,
            logFile: path.join(folders.make('artemis-det-'), 'a.log')
        });

        expect(outcome).toMatchObject({ pid: undefined, notFound: true });
    });

    test('a folder that does not exist fails before the folders of the log are created', async () => {
        const root = folders.make('artemis-det-');
        const outcome = await start(SILENT_JOB, 'a.log', path.join(root, 'typo'));

        expect([outcome.cwdProblem, fs.existsSync(path.join(root, 'typo'))]).toEqual([
            FOLDER_PROBLEM.MISSING,
            false
        ]);
    });

    test('a folder that is a file is not-a-folder, not a log problem', async () => {
        const root = folders.make('artemis-det-');
        const file = path.join(root, 'plain.txt');

        fs.writeFileSync(file, 'x');

        expect(await start(SILENT_JOB, 'a.log', file)).toMatchObject({
            pid: undefined,
            cwdProblem: FOLDER_PROBLEM.NOT_A_FOLDER
        });
    });

    test.skipIf(isRoot)(
        'a folder under one that cannot be read is no-access, not a raw error',
        async () => {
            const locked = path.join(folders.make('artemis-det-'), 'locked');

            fs.mkdirSync(path.join(locked, 'sub'), { recursive: true });

            const outcome = await withMode(locked, UNREADABLE_MODE, () =>
                start(SILENT_JOB, 'a.log', path.join(locked, 'sub'))
            );

            expect(outcome).toMatchObject({ pid: undefined, cwdProblem: FOLDER_PROBLEM.NO_ACCESS });
        }
    );

    test.skipIf(isRoot)(
        'a folder with no execute bit is no-access, and no log folder is made',
        async () => {
            const folder = folders.make('artemis-det-');

            const outcome = await withMode(folder, NO_EXECUTE_MODE, () =>
                start(SILENT_JOB, 'logs/a.log', folder)
            );

            expect([outcome.cwdProblem, fs.existsSync(path.join(folder, 'logs'))]).toEqual([
                FOLDER_PROBLEM.NO_ACCESS,
                false
            ]);
        }
    );

    test('a log file that cannot be opened is a CommandError naming the file', async () => {
        const root = folders.make('artemis-det-');

        fs.writeFileSync(path.join(root, 'plain'), 'x');

        await expect(start(SILENT_JOB, path.join(root, 'plain', 'a.log'))).rejects.toBeInstanceOf(
            CommandError
        );
    });
});
