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
- The flags `--help`, `--json`, `--yes` and the short flags `-h`, `-y` are reserved: every command already has them.
- Any other field you add to the definition passes through untouched.

`run` receives `{ args, flags, ctx }`, typed from the definition. With `// @ts-check` (or in TypeScript) a required arg is a `string`, an optional one `string | undefined`, `choices` narrow to their union, and reading an arg or flag you did not declare is a type error.

`ctx` offers: `log(...)` (stdout, silent with `--json`), `warn(...)` (stderr), `prompt(questions, { hint })`, `json`, `interactive`, `style`, `commands` (every discovered command) and `invoke(id, argv)` (run another command and get its result).

Return a value from `run` to give the command a result. Throw `CommandError(message, { hint })` for a failure the caller can fix, and put in `hint` what to do about it. A plain `Error` means a bug and prints a stack.

## Calling a command (the contract an agent relies on)

- **`art help --json`** prints one JSON manifest of every command: its `id`, `description`, `usage`, `aliases`, `args` (name, description, required, default, choices), `flags` (name, type, short, multiple, description, default, choices) and `examples`, plus the global flags. Read it first to learn what exists. `art help <command> --json` gives one command's entry.
- **`--json` on any call** prints exactly one object on stdout and nothing else:
    - success: `{ "ok": true, "command": "math add", "result": { "sum": 3 } }`
    - failure: `{ "ok": false, "command": "math add", "error": "Both arguments must be numbers", "hint": "Try: math add 1 2" }` (`hint` is omitted when there is none; `command` is `null` when no command was resolved)
- **Exit codes:** `0` success, `1` the command failed, `2` the command line was wrong (unknown command, bad or missing argument, unknown flag).
- **Global flags can go before or after the command name** (`art --json math add 1 2`); any other flag goes after the command. After `--`, everything is a plain argument.
- **`--yes` never prompts.** Pass it when nobody can answer. `--json` never prompts either, so stdout stays one object. A command uses `ctx.interactive` to decide whether to ask, and falls back to flags, saved values or defaults.
- **Prompts never hang.** When a command prompts and nobody can answer (a pipe, `--yes`, an agent), `ctx.prompt` throws a `CommandError` whose `hint` says how to answer without a prompt (for example "Pass --yes to skip the question."). Read the `hint`, add the flag, call again.

## Running the CLI

You do not write a `bin` file. Installing the package gives the commands `art` and `artemis` (the same command): run `npx art` in a project, or `art` if it is installed globally.

- **The project is the nearest `package.json` that says it is one**: it has an `artemis` key (what `art init` writes) or a `commands/` folder next to it, looking in the current folder and then each parent. Any other `package.json` (a `{ "type": "module" }` file in `src/` or `dist/`, with any keys; a template; a monorepo package with neither) is skipped, so `art` works from any folder inside the project and a monorepo package without its own commands uses the root's. A project without a commands folder fails with "Commands folder not found"; point `"artemis": { "commandsDir" }` at a parent's (for example `"../commands"`) to share them. A `package.json` that cannot be parsed is an error naming the file, never skipped. Two projects never see each other's commands.
- **`art init [--json]` makes the current folder a project**: a `package.json` with the `artemis` key (created, or one line added to yours without reformatting it), a `commands/` folder and a sample `hello` command. It never overwrites a file, and running it again changes nothing. It takes no arguments and no flags but `--json` and `--help` (it is a fixed word of the binary, not a command, so `--yes` and a folder are usage errors: `cd` first). `init` is a word of the shipped `art`, like `help`, so a project command called `init` cannot be run through it.
- **Settings, all optional**, under the `artemis` key of that `package.json`: `"artemis": { "commandsDir": "tools/commands", "bin": "mytool" }`. `commandsDir` is relative to the folder of that `package.json` (default `commands`). `bin` is the name help and usage lines show; the shipped `art` shows `art` unless you set it, whatever CLI the project publishes.
- **Command files are ES modules**: set `"type": "module"` in the project's `package.json`, or Node prints a warning for each file.
- **A global `art` needs no copy of Artemis in the project.** `import ... from '@zjaaal/artemis'` in a command file resolves to the running copy; a copy the project installed itself wins, and errors from either copy keep their hint and exit code.
- **When it cannot find what to run** (no project upwards, no commands folder, a bad `artemis` key, an unreadable `package.json`) it exits `1` with a hint that says what to create or set; under `--json` that is `{ "ok": false, "command": null, "error", "hint" }`.

To ship the same CLI under its own name, a project adds a bin file, `import { cli } from '@zjaaal/artemis/cli'; process.exitCode = await cli({ root: import.meta.url });`, a `bin` field in its `package.json` (`"bin": { "mytool": "bin/mytool.js" }`) and `@zjaaal/artemis` as a dependency. It runs its own `commands/` wherever the user is standing: it is found through the nearest `package.json` with a name, a `bin` or an `artemis` key, and never past its folder in `node_modules`, so it never climbs into the project that installed it, and `commands/` has to ship with the package. Help shows `mytool`, and nothing is reserved for a tool, `init` included. To control everything yourself, call `run(argv, { bin, commandsDir })` from your own bin file: `bin` is required, and `run` returns the exit code without calling `process.exit`.

## Working on Artemis itself

- Read `docs/CODE_STANDARDS.md` first. It is binding: types in `models.ts`, constants in `constants.ts`, no magic numbers, no enums, no `any`, pure logic with side effects at the edges (`src/edges/`), no nested loops, JSDoc on exports, tests per section 7.
- `pnpm run test:all` runs `tsc`, `eslint`, `prettier --check` and `vitest` (type tests included). It must pass before a change is done. `pnpm run build` emits `dist/`, and `pnpm run check-exports` verifies the package entry points after a build, `pnpm run check-bin` runs the packed `art` and `artemis` in temporary projects, and `pnpm run check-lock` races real processes for the registry lock.
- Specs live in `specs/`. Work follows the spec: if something looks wrong, change the spec, not the code by surprise.
- Tests sit beside their source (`foo.ts` and `foo.test.ts`). Test helpers and the fixture command trees are in `src/test/` and only tests import from there. One case per test, no branching around assertions, no snapshots, fake only the edges (clock, prompts, terminal), never our own modules.
