import { EXIT_CODE, JSON_FLAG } from '../constants.js';
import { isFolder } from '../edges/files.js';
import { currentProcess } from '../edges/process.js';
import { homeDirectory, workingDirectory } from '../edges/system.js';
import { CommandError } from '../errors/errors.js';
import { reportError } from '../run/report.js';
import { run } from '../run/run.js';
import { resolveWorld } from '../run/world.js';
import { COMMANDS_FOLDER, ENV_COMMANDS, GLOBAL_BIN, PROJECT_FOLDER } from './constants.js';
import { locateCommands } from './locate.js';
import type { MainFn } from './models.js';

/**
 * The global `artemis` command: finds the commands folder for where it is run, then runs the
 * command line against it. Returns the exit code.
 */
export const main: MainFn = async (argv, options = {}) => {
    const cwd = options.cwd ?? workingDirectory();
    const env = options.env ?? currentProcess().env;
    const located = locateCommands({ cwd, home: options.home ?? homeDirectory(), env, isFolder });

    const shared = {
        bin: GLOBAL_BIN,
        stdout: options.stdout,
        stderr: options.stderr,
        interactive: options.interactive,
        color: options.color,
        env
    };

    if (located.kind === 'found') {
        return run(argv, { ...shared, commandsDir: located.location.dir });
    }

    const world = resolveWorld({ ...shared, commandsDir: '' });

    const error = new CommandError(
        `No commands folder found (looked for ${PROJECT_FOLDER}/${COMMANDS_FOLDER} from ${cwd} upwards, then the user folder).`,
        {
            hint: `Create ${PROJECT_FOLDER}/${COMMANDS_FOLDER} in your project and add one .js file per command, or set ${ENV_COMMANDS} to a commands folder. Searched: ${located.searched.join(', ')}`
        }
    );

    reportError(error, {
        io: world.io,
        style: world.style,
        json: argv.includes(JSON_FLAG),
        commandId: undefined
    });

    return EXIT_CODE.FAILED;
};
