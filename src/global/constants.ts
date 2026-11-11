/** The binary the package installs. */
export const GLOBAL_BIN = 'artemis';

/** The name of the package, which command files import the framework from. */
export const PACKAGE_NAME = '@zjaaal/artemis';

/** A project keeps its commands in `<project>/.artemis/commands`. */
export const PROJECT_FOLDER = '.artemis';
export const COMMANDS_FOLDER = 'commands';

/** Pins the commands folder, whatever the current folder is. */
export const ENV_COMMANDS = 'ARTEMIS_COMMANDS';

/** Moves the user-level folder (`~/.artemis`) somewhere else. */
export const ENV_HOME = 'ARTEMIS_HOME';
