/**
 * Artemis: drop a file in a folder, get a command.
 *
 *   commands/uve/config/set.js  ->  art uve config set
 *
 * Folders are topics, `_topic.js` describes a topic, and anything starting with "_" is private.
 * Every command gets --help, --json and --yes, and `art help --json` describes all of them.
 */
export { EXIT_CODE } from './constants.js';
export { defineCommand, defineTopic } from './define/define.js';
export { CommandError, UsageError } from './errors/errors.js';
export type {
    ArgDefinition,
    Command,
    CommandContext,
    CommandDefinition,
    ExecFn,
    ExecOptions,
    ExecResult,
    ExitCode,
    FlagDefinition,
    InferArgs,
    InferFlags,
    NextFn,
    PlanFn,
    RunInput,
    RunOptions,
    TopicDefinition
} from './models.js';
export { run } from './run/run.js';
