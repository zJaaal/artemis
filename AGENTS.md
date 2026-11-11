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

Artemis is a library: your project owns the `bin` file.

```js
#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '@zjaaal/artemis';

const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../commands');

process.exitCode = await run(process.argv.slice(2), { bin: 'art', commandsDir });
```

`bin` is required (it names the CLI in help and usage lines). `run` never calls `process.exit`: it returns the exit code.

## Working on Artemis itself

- Read `docs/CODE_STANDARDS.md` first. It is binding: types in `models.ts`, constants in `constants.ts`, no magic numbers, no enums, no `any`, pure logic with side effects at the edges (`src/edges/`), no nested loops, JSDoc on exports, tests per section 7.
- `pnpm run test:all` runs `tsc`, `eslint`, `prettier --check` and `vitest` (type tests included). It must pass before a change is done. `pnpm run build` emits `dist/`, and `pnpm run check-exports` verifies the package entry points after a build.
- Specs live in `specs/`. Work follows the spec: if something looks wrong, change the spec, not the code by surprise.
- Tests sit beside their source (`foo.ts` and `foo.test.ts`). Test helpers and the fixture command trees are in `src/test/` and only tests import from there. One case per test, no branching around assertions, no snapshots, fake only the edges (clock, prompts, terminal), never our own modules.
