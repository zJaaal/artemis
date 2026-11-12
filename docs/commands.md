[Back to the README](../README.md)

# The quiver: how files become commands

| What you write                | What you get                                                       |
| ----------------------------- | ------------------------------------------------------------------ |
| `commands/hello.js`           | `art hello`                                                        |
| `commands/db/migrate.js`      | `art db migrate`, and also `art db:migrate`                        |
| `commands/db/_topic.js`       | the description of the `db` group (`defineTopic({ description })`) |
| `commands/_shared.js`         | nothing: files and folders starting with `_` or `.` are private    |
| `aliases: ['m']` in a command | `art m` runs it too                                                |

- Only `.js` files are commands. A folder with at least one command becomes a topic automatically, however deep.
- A file that does not default-export `defineCommand(...)`, or that throws when it loads, is **skipped with a warning** on stderr, so one bad file does not take the CLI down.
- An alias that is already the name of a command, a topic or another alias is ignored with a warning.
- Words are matched greedily: `art db migrate --force` is the command `db migrate` with the flag `--force`.
- A mistyped name suggests the closest one: `Did you mean "hello"?`.

A topic file:

```js
// commands/db/_topic.js
import { defineTopic } from '@zjaaal/artemis';

export default defineTopic({ description: 'Database tasks' });
```

## Writing an arrow: `defineCommand`

```js
import { defineCommand, CommandError } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Add two numbers', // required, one line
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

        ctx.log(`sum: ${sum}`);

        return { sum: flags.round ? Math.round(sum) : sum };
    }
});
```

### Definition fields

| Field         | Required | What it is                                                                                |
| ------------- | -------- | ----------------------------------------------------------------------------------------- |
| `description` | yes      | One line, shown by `help` and `help --json`.                                              |
| `run`         | yes      | `({ args, flags, ctx }) => result`. May be `async`. The result is printed under `--json`. |
| `args`        |          | Positional arguments, in order.                                                           |
| `flags`       |          | Flags, by name.                                                                           |
| `aliases`     |          | Other names the command answers to.                                                       |
| `examples`    |          | Example invocations, without the binary name. Shown by `--help` and `help --json`.        |
| `destructive` |          | `true` for a command that changes or deletes data nobody can get back. Enforced (below).  |
| `dryRun`      |          | `true` when the command honors `--dry-run` (below).                                       |
| anything else |          | Passes through untouched, so a project can build its own conventions on top.              |

**Args** (`{ name, description?, required?, default?, choices? }`): a required arg cannot have a default, and a required arg cannot come after an optional one. `choices` limits the allowed values.

**Flags** (`{ type, short?, multiple?, default?, choices?, description? }`):

- `type` is `'boolean'` or `'string'`.
- `short` is a single character (`-s`).
- `multiple: true` lets a string flag repeat (`--tag a --tag b` gives `['a', 'b']`), and its `default` is then an array of strings.
- `default` must match the type: a boolean for a boolean flag, a string for a string flag.
- `help`, `json`, `yes`, `dry-run`, `quiet` and `log` (and `-h`, `-y`) are reserved: every command already has them.

`defineCommand` throws a `TypeError` right away, with a message that names the problem, if a definition breaks one of these rules.

**`destructive: true`** is enforced before `run`: in a terminal Artemis asks ("art wipe changes or deletes data that cannot be recovered. Continue?", default no; declining is `Cancelled.`, exit `1`), with `--yes` it runs, and with nobody to answer (a pipe, an agent, `--json`) it fails before `run` with the hint "Pass --yes to confirm." and, when the command supports a dry run, "Pass --dry-run first to see what it would do.". Drop your own confirm. `ctx.invoke` of a destructive command passes the caller's `--yes` and `--dry-run` along; without them it asks again or fails the caller, because a confirmation covers the command the user named, not the ones it calls.

**`dryRun: true`** says the command honors `ctx.dryRun`. `--dry-run` on any other command is a usage error (exit `2`), so nothing ever runs by surprise. Under `--dry-run` nothing is asked, `ctx.plan(step)` collects steps, `ctx.exec` starts no child (it adds itself to the plan), and the envelope gets `dryRun: true` and `plan` (`[]` when nothing was planned). In text mode the plan prints as a list after the command's own output (or "Nothing to do."), and `--quiet` never hides it. A call that must run to tell you what it would do (`git rev-parse`) passes `readOnly: true` to `ctx.exec`: it runs for real, captured, and adds nothing to the plan. A command that needs the output of any other call checks `ctx.dryRun`. `ctx.invoke` of a command with `dryRun: true` passes `--dry-run` along and appends its plan to the caller's; invoking one without it under `--dry-run` fails the caller with exit `1`.

### Results and errors

- **Return a value** from `run` to give the command a result. With `--json` it becomes the `result` of the output object.
- **Throw `CommandError(message, { hint })`** for a failure the caller can fix. The message and the hint are shown without a stack trace, and the command exits `1`. Put in `hint` what to do about it.
- **Throw `UsageError(message, { hint, usage })`** when the command line itself is wrong. It exits `2`.
- **Any other error** is treated as a bug: it exits `1` and prints a stack trace.

### The `ctx` your command receives

| Field                          | What it does                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.log(...)`                 | Human output on stdout. **Silent under `--json`**, so stdout stays one JSON object.                                                                                                                                                      |
| `ctx.warn(...)`                | Progress and warnings on stderr. Never mixes with `--json` output.                                                                                                                                                                       |
| `ctx.prompt`                   | Asks the user: `confirm`, `text`, `select` and `multiselect`, each returning the answer itself. When nobody can answer it throws a `CommandError` with `hint`. See [Prompts](cli.md#prompts).                                            |
| `ctx.interactive`              | `true` only when a prompt may be shown. See [Prompts](cli.md#prompts).                                                                                                                                                                   |
| `ctx.json`                     | Whether the run was asked for `--json`.                                                                                                                                                                                                  |
| `ctx.quiet`                    | Whether the run was asked for `--quiet`.                                                                                                                                                                                                 |
| `ctx.dryRun`                   | Whether `--dry-run` was passed (only ever `true` for a command with `dryRun: true`).                                                                                                                                                     |
| `ctx.plan(step)`               | Under `--dry-run`, describes one thing the command would do. A no-op otherwise.                                                                                                                                                          |
| `ctx.next(...lines)`           | Suggests what to run after this succeeds: what follows the bin (`'dotcms wait --instance x --json'`), which Artemis adds. Goes out as `next` in the envelope; printed as `Next:` lines on stderr in text mode.                           |
| `ctx.exec(cmd, args, options)` | Runs a child process, never through a shell. Its output follows `--quiet`, `--log` and `--json`. See "Running children" below.                                                                                                           |
| `ctx.style`                    | Color helpers (`bold`, `dim`, `red`, `green`, `yellow`, `cyan`); plain text when color is off.                                                                                                                                           |
| `ctx.commands`                 | Every discovered command, for building lists of commands to run in order.                                                                                                                                                                |
| `ctx.invoke(id, argv)`         | Runs another command by id or alias and returns its result. It inherits `--json`, `--yes`, `--dry-run`, `--quiet` and the `--log` file. A bad call (unknown command, wrong arguments, `--help`) fails the calling command with exit `1`. |

### Running children: `ctx.exec`

```js
const { code, output } = await ctx.exec('docker', ['compose', 'up', '-d'], { cwd: '/srv/app' });
```

`args` is an array and nothing in it is interpreted (no shell), so a value with spaces or `$(...)` reaches the child as one unchanged string. Options: `cwd`, `env` (default: the process environment), `capture` (return the output instead of showing it), `readOnly` (the call changes nothing, so it runs even under `--dry-run`, captured), `reject` (default `true`: a non-zero exit throws; `false` returns `{ code }`) and `timeoutMs` (SIGTERM, then SIGKILL after 5 s; always throws). It resolves to `{ code, output, skipped }`: `output` is stdout and stderr interleaved, and empty when the output went to the terminal or the call was skipped.

How the child's output travels is the first row that applies:

| Mode                    | Child stdout                                         | Child stderr           | Kept for `tail` |
| ----------------------- | ---------------------------------------------------- | ---------------------- | --------------- |
| `capture` or `readOnly` | into `output`, not shown                             | same                   | yes             |
| `--quiet`               | piped, not shown                                     | piped, not shown       | yes             |
| `--json`                | piped, shown on **stderr** (stdout stays one object) | piped, shown on stderr | yes             |
| text with `--log`       | piped, shown on stdout                               | piped, shown on stderr | yes             |
| text, none of the above | inherited: colors and progress bars keep working     | inherited              | no              |

`--log` is a copy of every piped row, not a mode of its own. Piping loses the child's colors and progress bars, so text mode keeps the child on your terminal unless something needs the bytes (`--json`, `--quiet`, `--log` or `capture`): a person who runs with `--log` gives them up for that run.

A child that exits non-zero fails the command (exit `1`) with "<command> exited with code N", and the failure envelope carries `tail`, the last 40 lines of the child (each cut at 500 characters). In text mode, when the output was hidden (`--quiet` or `capture`), the tail is printed under the error so a person sees why. A missing executable is "<command> was not found". Output comes back in `output` only to a call that passes `capture` or `readOnly`; every other call returns `''`, so a child that runs for hours does not grow Artemis's memory. Every child a command started is killed when its `run` ends, concurrent ones included. Only the child itself is signalled: a process it started (a dev server behind `npm run dev`) keeps running and keeps its port (under `--json`, `--quiet`, `--log` or `capture` its output pipe stays open and is read and thrown away while Artemis runs; once Artemis exits the pipe closes, and a grandchild that writes then may die), so run the program itself (not `npm run dev`) or stop it in its own way: a `timeoutMs` signals only the child too. A SIGTERM sent to Artemis alone is not forwarded to its children: signal the process group.

`tail`, `--log` and the lines of a plan hold what was passed or printed, as it is. A secret passed as an argument shows up there; pass secrets through `env`, which is never shown.

### Typed arguments and flags

`run({ args, flags })` is typed from the definition, so command files get editor feedback even in plain JavaScript with `// @ts-check`:

```js
// @ts-check
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Pick a color',
    args: [{ name: 'color', choices: ['red', 'blue'], default: 'red' }],
    flags: { tag: { type: 'string', multiple: true } },
    run({ args, flags }) {
        args.color; // 'red' | 'blue'
        flags.tag; // string[] | undefined
        // args.size  -> type error: not declared
    }
});
```

| Declared as                           | `run` sees                                          |
| ------------------------------------- | --------------------------------------------------- |
| a required arg, or one with a default | `string`                                            |
| an optional arg                       | `string \| undefined`                               |
| `choices`                             | the union of the choices                            |
| a boolean flag                        | `boolean \| undefined` (`boolean` with a default)   |
| a string flag                         | `string \| undefined` (`string` with a default)     |
| a `multiple` flag                     | `string[] \| undefined` (`string[]` with a default) |

The helper types `InferArgs`, `InferFlags`, `RunInput`, `Command`, `CommandDefinition`, `CommandContext`, `ArgDefinition`, `FlagDefinition` and `RunOptions` are exported for TypeScript users.
