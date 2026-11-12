# AGENTS.md

How to use Artemis to give a project a command line, and how to work on Artemis itself.

## Adding a command (for an agent writing its own tooling)

Artemis finds commands by walking a folder: **one `.js` file is one command, one folder is one topic**. There is no list to keep up to date. Drop a file in the commands folder and the command exists.

```
commands/hello.js            ->  art hello
commands/math/add.js         ->  art math add     (also art math:add)
commands/math/_topic.js      ->  describes the "math" topic (optional)
commands/_helpers.js         ->  not a command: files and folders starting with "_" or "." are private
```

A command file default-exports `defineCommand(...)`:

```js
import { defineCommand, CommandError } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Add two numbers', // required, one line: it is what `help` and `help --json` show
    aliases: ['sum'],
    args: [
        { name: 'a', required: true, description: 'First number' },
        { name: 'b', required: true, description: 'Second number' }
    ],
    flags: {
        round: { type: 'boolean', short: 'r', description: 'Round the result' }
    },
    examples: ['math add 1 2'],
    run({ args, flags, ctx }) {
        const sum = Number(args.a) + Number(args.b);

        if (Number.isNaN(sum)) {
            throw new CommandError('Both arguments must be numbers', { hint: 'Try: math add 1 2' });
        }

        ctx.log(`sum: ${sum}`); // human output; silent under --json
        return { sum: flags.round ? Math.round(sum) : sum }; // the result, printed under --json
    }
});
```

Rules a definition must follow (`defineCommand` throws a `TypeError` otherwise):

- `description` and `run` are required.
- Every arg has a `name`. An arg cannot be `required` and have a `default`. A required arg cannot come after an optional one.
- Flags are `type: 'boolean'` or `type: 'string'` (optionally `multiple: true`, `short`, `default`, `choices`).
- The flags `--help`, `--json`, `--yes`, `--dry-run`, `--quiet`, `--log` and the short flags `-h`, `-y` are reserved: every command already has them.
- `destructive` and `dryRun` are optional and must be `true` or `false` (below).
- Any other field you add to the definition passes through untouched.

`run` receives `{ args, flags, ctx }`, typed from the definition. With `// @ts-check` (or in TypeScript) a required arg is a `string`, an optional one `string | undefined`, `choices` narrow to their union, and reading an arg or flag you did not declare is a type error.

`ctx.prompt` is four methods: `await ctx.prompt.confirm('Sure?', { initial })` is a `boolean`, `text('Name?', { initial })` a `string`, `select('Runner?', { choices: [{ label: 'Node', value: 'node' }] })` one of the literal values, and `multiselect(message, { choices: [{ label, value, selected }] })` an array of them. Each takes `{ hint }` too, the hint of the error thrown when nobody can answer.

`ctx` offers: `log(...)` (stdout, silent with `--json`), `warn(...)` (stderr), `prompt` (four methods that return the answer, see below), `json`, `quiet`, `interactive`, `style`, `commands` (every discovered command), `invoke(id, argv)` (run another command and get its result), `dryRun`, `plan(step)`, `next(...lines)` and `exec(command, args, options)`.

- **`destructive: true`** marks a command that changes or deletes data nobody can get back. Artemis enforces it before `run`: in a terminal it asks, and with nobody to answer it fails with the hint "Pass --yes to confirm." So do not write your own confirm for it. `help --json` shows it.
- **`dryRun: true`** says the command honors `ctx.dryRun`: under `--dry-run` it reports what it would do and does none of it. `ctx.plan('remove the data folder')` adds one line to the plan (a no-op otherwise), and the plan goes out as `plan` in the envelope. `--dry-run` on a command without `dryRun: true` is a usage error (exit 2), so nothing runs by surprise.
- **`ctx.exec(command, args, options)`** runs a child process, never through a shell (`args` is an array, so nothing in it is interpreted). Prefer it to `spawn`: its output follows `--quiet`, `--log` and `--json` (under `--json` the child's stdout goes to stderr, so stdout stays one object), a failed child becomes a `CommandError` that carries the last lines as `tail`, and a child you leave running is killed when `run` ends. Options: `cwd`, `env`, `capture` (return the output instead of showing it: `result.output`), `reject: false` (a non-zero exit returns `{ code }` instead of throwing), `timeoutMs` and `readOnly`. Under `--dry-run` a call is not started: it is added to the plan and returns `{ skipped: true }`. Mark `readOnly: true` only a call that changes nothing (`git rev-parse`, `docker ps`): it runs for real, captured, even under `--dry-run`.
- **`ctx.next('dotcms wait --instance x --json')`** suggests what to run after this succeeds. Pass what follows the bin; Artemis adds it. Give context as a flag or argument, never as an `ENV=1` prefix (it is invisible in `help --json`). They go out as `next` in the success envelope and are dropped on failure.
- **Progress belongs in `ctx.warn`, not `ctx.log`.** `--quiet` hides `ctx.warn` (and child output, and the Next: lines), but `ctx.log` is the command's result for people and stays.

Return a value from `run` to give the command a result. Throw `CommandError(message, { hint })` for a failure the caller can fix, and put in `hint` what to do about it. A plain `Error` means a bug and prints a stack.

## Calling a command (the contract an agent relies on)

- **`art help --json --brief`** is where to start: only ids and one-line descriptions, plus `destructive` and `dryRun` when a command has them (the two facts you must not miss before calling), and `more`, which says how to get one command in full. `art help <topic> --json --brief` narrows it. Then `art help <command> --json` for the one you need. `art help --agents` prints this file.
- **`art help --json`** prints one JSON manifest of every command: its `id`, `description`, `usage`, `aliases`, `args` (name, description, required, default, choices), `flags` (name, type, short, multiple, description, default, choices) and `examples`, plus the global flags. Read it first to learn what exists. `art help <topic> --json` narrows it to that topic's commands (same shape), and `art help <command> --json` gives one command's entry.
- **`--json` on any call** prints exactly one object on stdout and nothing else:
    - success: `{ "ok": true, "command": "math add", "result": { "sum": 3 } }`
    - failure: `{ "ok": false, "command": "math add", "error": "Both arguments must be numbers", "hint": "Try: math add 1 2" }` (`hint` is omitted when there is none; `command` is `null` when no command was resolved)
    - more keys come after those, only when they apply: `dryRun: true` and `plan` (a dry run: the steps it would take, `[]` when none), `next` (the commands to run next, each with the bin in front), `log` (the absolute path of the `--log` file, on success and failure) and `tail` (a failure that came from a child: its last lines, at most 40 of at most 500 characters)
- **Exit codes:** `0` success, `1` the command failed, `2` the command line was wrong (unknown command, bad or missing argument, unknown flag).
- **Global flags can go before or after the command name** (`art --json math add 1 2`); any other flag goes after the command. After `--`, everything is a plain argument. The global flags are `--help`, `--json`, `--yes`, `--dry-run`, `--quiet` and `--log <file>`: `--quiet` hides warnings, the Next: lines and child output (the result and errors still print), and `--log` writes everything the command and its children print to a file, even what `--quiet` hides. Add one of them to a call that floods you with output.
- **A destructive command needs `--yes`** when nobody can answer (a pipe, an agent, `--json`): it fails before it runs with the hint "Pass --yes to confirm.", and "Pass --dry-run first to see what it would do." when it supports a dry run. Look at `--dry-run` first, then pass `--yes`.
- **`--yes` never prompts.** Pass it when nobody can answer. `--json` never prompts either, so stdout stays one object. A command uses `ctx.interactive` to decide whether to ask, and falls back to flags, saved values or defaults.
- **Prompts never hang.** When a command prompts and nobody can answer (a pipe, `--yes`, an agent), `ctx.prompt` throws a `CommandError` whose `hint` says how to answer without a prompt (for example "Pass --yes to skip the question."). Read the `hint`, add the flag, call again. If `--yes` or `--json` was already passed, the default hint says the command asks regardless: answer it with the flags the command documents (`help <command> --json`), because those two flags never answer a question. `--yes` never answers a question with its default: the command decides what `--yes` means, usually by skipping the question when `ctx.interactive` is `false`.

## Running the CLI

You do not write a `bin` file. Installing the package gives the commands `art` and `artemis` (the same command): run `npx art` in a project, or `art` if it is installed globally.

- **The project is the nearest `package.json` that says it is one**: it has an `artemis` key (what `art init` writes) or a `commands/` folder next to it, looking in the current folder and then each parent. Any other `package.json` (a `{ "type": "module" }` file in `src/` or `dist/`, with any keys; a template; a monorepo package with neither) is skipped, so `art` works from any folder inside the project and a monorepo package without its own commands uses the root's. A project without a commands folder fails with "Commands folder not found"; point `"artemis": { "commandsDir" }` at a parent's (for example `"../commands"`) to share them. A `package.json` that cannot be parsed is an error naming the file, never skipped. Two projects never see each other's commands.
- **`art init [--json]` makes the current folder a project**: a `package.json` with the `artemis` key (created, or one line added to yours without reformatting it), a `commands/` folder and a sample `hello` command. It never overwrites a file, and running it again changes nothing. It takes no arguments and no flags but `--json` and `--help` (it is a fixed word of the binary, not a command, so `--yes` and a folder are usage errors: `cd` first). `init` is a word of the shipped `art`, like `help` (and `state`, `skill` and `doctor`), so a project command called `init`, `state`, `skill` or `doctor` cannot be run through it. Every built-in word takes `--quiet` and refuses `--dry-run` and `--log` (exit `2`).
- **`art state [<doc>] [--reset] [--yes] [--json]` lists, shows and resets what the app keeps** (the documents of the store kit, `@zjaaal/artemis/store`, in the state folder). `art state` lists them (name, version, path), `art state <doc>` shows one (under `--json`: `{ name, version, file, data }`) and `art state <doc> --reset` deletes it so the app starts again from its defaults. A reset asks first; `--yes` skips the question, and without a terminal or under `--json` it fails with the hint "Pass --yes to reset without a question." An unknown document exits `1` and the hint lists the ones that exist; a second argument, an unknown flag or `--reset` with no document exits `2`, and so does a non-global flag typed before the word (`art --reset state x`). A document that cannot be read is listed with an `error` and `version: null`; a `stateDir` that is a file exits `1` with a hint. `art state --help --json` (and `art init --help --json`) print one object with the word's manifest entry. It is a word of the shipped `art`, like `init`, listed in `art help --json` under `builtins`.
- **`art skill [--write <path>] [--yes] [--json]` writes a short `SKILL.md`** from the commands of the project: how to find and call a command, the destructive ones and a few examples. It prints it, or with `--write` writes it (creating the folders) and asks before it overwrites a file (`--yes` skips the question; without a terminal or under `--json` it needs `--yes`).
- **`art doctor [--json]` checks the install and the project**, and every problem comes with a `fix`: which Artemis runs against the range the project wants and the copy it installs, `"type": "module"`, that the commands load, that no command hides a word of the binary, and that the state documents can be read. Exit `0` with warnings only, `1` when a check fails; a failing `--json` run keeps its `checks`. On every other run of the shipped `art` one line on stderr says when the running version is not the one the project wants or installs (hidden by `--quiet`, never in the envelope).
- **Settings, all optional**, under the `artemis` key of that `package.json`: `"artemis": { "commandsDir": "tools/commands", "bin": "mytool", "stateDir": "data" }`. `commandsDir` is relative to the folder of that `package.json` (default `commands`). `bin` is the name help and usage lines show; the shipped `art` shows `art` unless you set it, whatever CLI the project publishes. `stateDir` is where the store kit keeps its documents (default `state`), the folder `art state` reads and `defineStore({ project: import.meta.url })` writes to.
- **Command files are ES modules**: set `"type": "module"` in the project's `package.json`, or Node prints a warning for each file.
- **A global `art` needs no copy of Artemis in the project.** `import ... from '@zjaaal/artemis'` in a command file resolves to the running copy; a copy the project installed itself wins, and errors from either copy keep their hint and exit code.
- **When it cannot find what to run** (no project upwards, no commands folder, a bad `artemis` key, an unreadable `package.json`) it exits `1` with a hint that says what to create or set; under `--json` that is `{ "ok": false, "command": null, "error", "hint" }`.

To ship the same CLI under its own name, a project adds a bin file, `import { cli } from '@zjaaal/artemis/cli'; process.exitCode = await cli({ root: import.meta.url });`, a `bin` field in its `package.json` (`"bin": { "mytool": "bin/mytool.js" }`) and `@zjaaal/artemis` as a dependency. It runs its own `commands/` wherever the user is standing: it is found through the nearest `package.json` with a name, a `bin` or an `artemis` key, and never past its folder in `node_modules`, so it never climbs into the project that installed it, and `commands/` has to ship with the package. Help shows `mytool`, and nothing is reserved for a tool, `init`, `state`, `skill` and `doctor` included, and its `help --json` has no `builtins`. To control everything yourself, call `run(argv, { bin, commandsDir })` from your own bin file: `bin` is required, and `run` returns the exit code without calling `process.exit`.

Working on Artemis itself: read CONTRIBUTING.md in the repository (it is not in the package).
