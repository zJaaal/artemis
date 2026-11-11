<h1 align="center">🏹 Artemis</h1>

<p align="center"><strong>Every file an arrow. Every folder a quiver.</strong></p>

<p align="center">
  <a href="https://github.com/zJaaal/artemis/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zJaaal/artemis/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen">
  <img alt="ESM only" src="https://img.shields.io/badge/module-ESM-blue">
  <img alt="Types included" src="https://img.shields.io/badge/types-included-blue">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-lightgrey">
</p>

Artemis turns a folder of files into a command line. Every file is a command, every folder is a group of commands, and there is no registry to keep up to date: Artemis hunts down whatever you drop in the folder.

It was built so that **AI agents can write their own CLI tooling**. An agent drops one file in a folder and gets a command, and everything it needs to call that command (arguments, flags, defaults, allowed values, examples) is machine-readable. People get a normal CLI with `--help`; agents get `help --json`.

```
commands/
  hello.js            ->  art hello
  db/
    _topic.js         ->  describes the "db" group
    migrate.js        ->  art db migrate
    reset.js          ->  art db reset
```

## The hunt, in one table

The metaphor is branding. In the API, the help text and the errors, things keep their plain names.

| In the story | In the code                                                 |
| ------------ | ----------------------------------------------------------- |
| An **arrow** | A command: one `.js` file                                   |
| A **quiver** | A folder: `commands/` itself, or a topic inside it          |
| **The hunt** | Discovery: Artemis walks the folder and finds every command |
| **`art`**    | The CLI you build on it (the name is yours)                 |

## Why it is built this way

- **One file, one command.** No central list to edit. Delete the file and the command is gone.
- **Machine-readable by default.** `help --json` lists every command with its arguments, flags, defaults, choices and examples. With `--json`, every call prints exactly one JSON object.
- **Honest exit codes.** `0` success, `1` the command failed, `2` the command line was wrong.
- **Never hangs.** `--yes` and `--json` never prompt, and a prompt that nobody can answer fails with a hint instead of waiting forever.
- **Typed.** `run({ args, flags })` is typed from the definition, even in plain JavaScript with `// @ts-check`.
- **Small.** ESM only, Node 22 or newer, and one runtime dependency (`prompts`), loaded only when a command asks a question.

## Install

```sh
pnpm add -D @zjaaal/artemis      # in a project: run it with `npx art`
# or: npm install --save-dev @zjaaal/artemis

npm install --global @zjaaal/artemis   # anywhere: run it as `art` (or `artemis`, the same command)
```

Installing the package puts two commands on your path, `art` and `artemis`. They are the same file, so use whichever you like. TypeScript users who use the types of `ctx.prompt` can add `@types/prompts` (an optional peer dependency; plain JavaScript never needs it).

## Quick start

No bin file, no boilerplate: a project is a `package.json` and a `commands/` folder next to it.

**1. Make sure your `package.json` says `"type": "module"`.** Command files are ES modules, and without it Node prints a warning about each one on stderr.

```json
{ "name": "my-project", "type": "module" }
```

**2. Drop a command in `commands/`.**

```js
// commands/hello.js
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Greet someone',
    args: [{ name: 'name', description: 'Who to greet', default: 'world' }],
    flags: { shout: { type: 'boolean', short: 's', description: 'Uppercase the greeting' } },
    run({ args, flags, ctx }) {
        const greeting = `hello ${args.name}`;
        const text = flags.shout ? greeting.toUpperCase() : greeting;

        ctx.log(text);

        return { greeting: text };
    }
});
```

**3. Run it.**

```console
$ npx art hello ana --shout
HELLO ANA

$ npx art hello ana --json
{"ok":true,"command":"hello","result":{"greeting":"hello ana"}}

$ npx art help
```

If you installed it globally, drop the `npx` and run `art hello` from the project or any folder inside it. A globally installed `art` does not need a copy of Artemis in the project: it makes `import ... from '@zjaaal/artemis'` in your command files resolve to the copy that is running them (a copy the project installed itself always wins).

### How `art` finds your project

`art` looks for the **nearest `package.json`**, starting in the current folder and then each parent. That folder is the project, even when its `package.json` has no `artemis` key (in a monorepo, the package you stand in wins), and its `commands/` folder holds the commands. Two projects on one machine never see each other's commands.

Both settings are optional, under the `artemis` key of that `package.json`:

```json
{ "artemis": { "commandsDir": "tools/commands", "bin": "mytool" } }
```

| Setting       | What it does                                                        | Default                                                     |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `commandsDir` | The commands folder, relative to the folder of that `package.json`. | `commands`                                                  |
| `bin`         | The name help and usage lines show.                                 | the single key of the project's own `bin` field, else `art` |

When it cannot find what to run, `art` exits `1` and says what to create or set, and with `--json` it prints the usual failure object with `command: null`:

| Problem                             | What the hint tells you                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| no `package.json` from here upwards | run `art` inside a project, or create a `package.json` with a `commands/` folder |
| the commands folder does not exist  | create it, or set `"artemis": { "commandsDir" }` in your `package.json`          |
| the `artemis` key has a bad shape   | the shape it should have                                                         |

### Your own command name

To ship the same CLI under your own name, give your package a bin file with one line:

```js
#!/usr/bin/env node
// bin/mytool.js
import '@zjaaal/artemis/cli';
```

and point `package.json` at it. Help and usage lines then show `mytool`, because it is the single key of your `bin` field (or set `"artemis": { "bin": "mytool" }`):

```json
{ "name": "my-project", "type": "module", "bin": { "mytool": "bin/mytool.js" } }
```

`@zjaaal/artemis/cli` is only meant to be imported by a bin file: importing it runs the CLI.

### Full control

If you want to decide the commands folder, the streams or the exit code yourself, call `run()` from your own bin file. See [`run(argv, options)`](#fully-in-control-runargv-options) below.

## The quiver: how files become commands

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
| anything else |          | Passes through untouched, so a project can build its own conventions on top.              |

**Args** (`{ name, description?, required?, default?, choices? }`): a required arg cannot have a default, and a required arg cannot come after an optional one. `choices` limits the allowed values.

**Flags** (`{ type, short?, multiple?, default?, choices?, description? }`):

- `type` is `'boolean'` or `'string'`.
- `short` is a single character (`-s`).
- `multiple: true` lets a string flag repeat (`--tag a --tag b` gives `['a', 'b']`), and its `default` is then an array of strings.
- `default` must match the type: a boolean for a boolean flag, a string for a string flag.
- `help`, `json` and `yes` (and `-h`, `-y`) are reserved: every command already has them.

`defineCommand` throws a `TypeError` right away, with a message that names the problem, if a definition breaks one of these rules.

### Results and errors

- **Return a value** from `run` to give the command a result. With `--json` it becomes the `result` of the output object.
- **Throw `CommandError(message, { hint })`** for a failure the caller can fix. The message and the hint are shown without a stack trace, and the command exits `1`. Put in `hint` what to do about it.
- **Throw `UsageError(message, { hint, usage })`** when the command line itself is wrong. It exits `2`.
- **Any other error** is treated as a bug: it exits `1` and prints a stack trace.

### The `ctx` your command receives

| Field                             | What it does                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.log(...)`                    | Human output on stdout. **Silent under `--json`**, so stdout stays one JSON object.                                                                                                            |
| `ctx.warn(...)`                   | Progress and warnings on stderr. Never mixes with `--json` output.                                                                                                                             |
| `ctx.prompt(questions, { hint })` | Asks the user (questions use the [`prompts`](https://github.com/terkelg/prompts) format). When nobody can answer it throws a `CommandError` with `hint`.                                       |
| `ctx.interactive`                 | `true` only when a prompt may be shown. See "Prompts" below.                                                                                                                                   |
| `ctx.json`                        | Whether the run was asked for `--json`.                                                                                                                                                        |
| `ctx.style`                       | Color helpers (`bold`, `dim`, `red`, `green`, `yellow`, `cyan`); plain text when color is off.                                                                                                 |
| `ctx.commands`                    | Every discovered command, for building lists of commands to run in order.                                                                                                                      |
| `ctx.invoke(id, argv)`            | Runs another command by id or alias and returns its result. It inherits `--json` and `--yes`. A bad call (unknown command, wrong arguments, `--help`) fails the calling command with exit `1`. |

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

## Using the CLI

```
art <topic> <command> [args] [flags]
```

### Flags every command has

| Flag         | What it does                                                  |
| ------------ | ------------------------------------------------------------- |
| `-h, --help` | Show help for the command.                                    |
| `--json`     | Print the result (or the error) as one JSON object on stdout. |
| `-y, --yes`  | Never prompt; use flags, saved values or defaults.            |

Global flags may be typed before or after the command name: `art --json math add 1 2` and `art math add 1 2 --json` are the same. Any other flag has to come after the command. After `--`, everything is a plain argument (`art echo -- --json` echoes the text `--json`).

### Getting help

| Ask                                 | You get                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `art` or `art help`                 | the topics and top-level commands                                       |
| `art <topic>` or `art <topic> help` | every command inside the topic                                          |
| `art <command> --help`              | the command's arguments, flags, defaults, choices, aliases and examples |
| `art help --json`                   | the manifest of every command, as data                                  |
| `art help <command> --json`         | the manifest entry of one command                                       |

### The JSON contract

With `--json`, every call prints **exactly one object** on stdout and nothing else:

```jsonc
// success
{ "ok": true, "command": "math add", "result": { "sum": 3 } }

// failure
{ "ok": false, "command": "math add", "error": "Both arguments must be numbers", "hint": "Try: math add 1 2" }
```

`hint` is left out when there is none, and `command` is `null` when no command was resolved (for example an unknown command). Warnings go to stderr, so stdout stays parseable.

The manifest from `help --json` has this shape:

```jsonc
{
    "bin": "art",
    "topics": [{ "id": "math", "description": "Arithmetic" }],
    "commands": [
        {
            "id": "math add",
            "description": "Add two numbers",
            "usage": "art math add <a> <b> [flags]",
            "aliases": ["sum"],
            "args": [
                {
                    "name": "a",
                    "description": "First number",
                    "required": true,
                    "default": null,
                    "choices": null
                }
            ],
            "flags": [
                {
                    "name": "round",
                    "type": "boolean",
                    "short": "r",
                    "multiple": false,
                    "description": "Round the result",
                    "default": null,
                    "choices": null
                }
            ],
            "examples": ["math add 1 2"]
        }
    ],
    "globalFlags": [/* help, json, yes */]
}
```

### Exit codes

| Code | Meaning                                                                            | In code            |
| ---- | ---------------------------------------------------------------------------------- | ------------------ |
| `0`  | success                                                                            | `EXIT_CODE.OK`     |
| `1`  | the command failed (a `CommandError`, or a bug)                                    | `EXIT_CODE.FAILED` |
| `2`  | the command line was wrong: unknown command, bad or missing argument, unknown flag | `EXIT_CODE.USAGE`  |

### Prompts

- A command asks with `ctx.prompt(...)`. In a terminal the user answers.
- `--yes` and `--json` mean nobody can answer, so `ctx.interactive` is `false` and `ctx.prompt` throws a `CommandError`. The same happens when there is no terminal (a pipe, an agent, CI).
- The hint of that error says how to answer without a prompt. Pass your own: `ctx.prompt(question, { hint: 'Pass --yes to accept the default.' })`. Without one, the hint says to pass `--yes` or the flags that answer the question.
- The good pattern: check `ctx.interactive`, and fall back to flags, saved values or defaults when it is `false`.

```js
async run({ ctx }) {
    if (!ctx.interactive) return { confirmed: true };

    const { confirmed } = await ctx.prompt({ type: 'confirm', name: 'confirmed', message: 'Sure?' });

    return { confirmed };
}
```

## For agents

Everything an agent needs to add a command and call one is in [AGENTS.md](AGENTS.md), and `npx art help --json` from the project folder is where it starts. The short version: read `art help --json` to learn what exists, call with `--json` to get one object back, branch on the exit code, and pass `--yes` when nobody can answer.

## Fully in control: `run(argv, options)`

A bin file that calls `run()` decides everything itself. `bin` is required: it is the name help and usage lines show.

```js
#!/usr/bin/env node
// bin/art.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '@zjaaal/artemis';

const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../commands');

process.exitCode = await run(process.argv.slice(2), { bin: 'art', commandsDir });
```

`run` resolves to the exit code and **never calls `process.exit`**, so you can embed it and test it.

| Option             | Required | What it is                                                                                              |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `bin`              | yes      | The name of your CLI, shown in help and usage lines.                                                    |
| `commandsDir`      | yes      | The folder to hunt for commands in.                                                                     |
| `stdout`, `stderr` | no       | Where output goes (anything with `write(chunk)`; a Node `Writable` fits). Default: the process streams. |
| `interactive`      | no       | Whether prompts may be shown. Default: stdin and stdout are terminals.                                  |
| `color`            | no       | Default: stdout is a terminal and `NO_COLOR` is unset.                                                  |
| `env`              | no       | The environment to read `NO_COLOR` from. Default: `process.env`.                                        |

### Testing your commands

Because `run` takes its world as options, a test passes in-memory sinks and asserts on what was written and on the exit code:

```js
import { run, EXIT_CODE } from '@zjaaal/artemis';

const sink = () => {
    let text = '';

    return {
        write: (chunk) => ((text += chunk), true),
        get text() {
            return text;
        }
    };
};

const stdout = sink();
const code = await run(['math', 'add', '1', '2', '--json'], {
    bin: 'art',
    commandsDir: new URL('../commands', import.meta.url).pathname,
    stdout,
    stderr: sink(),
    interactive: false,
    color: false
});

console.log(code === EXIT_CODE.OK, JSON.parse(stdout.text).result); // true { sum: 3 }
```

## Kits

Opt-in pieces, imported from their own subpath so apps that do not need them do not load them.

### Worktrees: `@zjaaal/artemis/worktrees`

Give every checkout of a repo its own **instance**: a stable slot, ports shifted by that slot, and a color, so several copies of an app can run side by side. The main checkout is slot 0 and needs no registration; other worktrees register on first use and keep their slot until removed. The kit keeps nothing of its own: the app says where the registry lives (`stateFile`).

```js
import { defineWorktrees } from '@zjaaal/artemis/worktrees';

const worktrees = defineWorktrees({
    stateFile: '/path/to/data/instances.json',
    mainCheckout: '/path/to/main/checkout',
    ports: { http: 8080, frontend: 4200 }
});

const instance = worktrees.ensure(); // registers the checkout you are in, on first use
instance.ports; // { http: 8180, frontend: 4300 } for slot 1
```

| Option         | What it is                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `stateFile`    | JSON file the registry is kept in (required).                                                                 |
| `mainCheckout` | Path of the main checkout, slot 0 (required).                                                                 |
| `ports`        | Base ports, shifted by `slot * slotStep` (required).                                                          |
| `isCheckout`   | `(root) => boolean`: whether a git root is a checkout of this app. Other repos count as outside any checkout. |
| `envVar`       | A variable that pins the instance by name, overriding the folder.                                             |
| `slotStep`     | Port shift per slot. Default `100`.                                                                           |
| `colors`       | One per slot, cycling.                                                                                        |
| `mainName`     | Name of the main instance. Default `"main"`.                                                                  |

| Method                           | What it does                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `list()`                         | Every instance: the main one first, then the registered ones by slot.                                                                         |
| `get(name)`                      | One instance by name, or a `CommandError`.                                                                                                    |
| `current({ cwd })`               | The instance for where the app runs. A worktree that is not registered refuses, with a hint, so nothing lands on another instance by mistake. |
| `ensure({ cwd, root, name })`    | The instance for a checkout, registering it on first use, named after its folder (with a suffix if taken).                                    |
| `ensureDetached({ name, meta })` | A named instance that belongs to no checkout (for example one per container image).                                                           |
| `remove(name)`                   | Forgets a registered instance and frees its slot. Never touches the worktree itself.                                                          |

Every write to the registry holds a lock file (`<stateFile>.lock`), so several processes registering at once each get their own slot. A lock left by a process that died is taken over safely.

### Terminal: `@zjaaal/artemis/terminal`

Describe terminal tabs as data and let an adapter open them. Only Warp is supported for now.

```js
import { openTabs, warp } from '@zjaaal/artemis/terminal';

openTabs(warp(), [
    {
        id: 'demo',
        name: 'demo',
        panes: [
            { dir: '/work/demo', run: ['art up'] },
            { dir: '/work/demo', run: ['art wait'], focus: true }
        ]
    }
]);
```

- A tab is `{ id, name, title?, color?, panes }`: a flat list of panes laid out left to right. Its `id` is a plain word (letters, digits, `-` and `_`), because it becomes a file name and part of a link.
- Instead of `panes`, a tab can take a `layout`: a tree of splits, `{ split: 'horizontal' | 'vertical', children: [pane | split, ...] }` (`horizontal` is side by side, `vertical` is stacked).
- A pane is `{ dir, run?: string[], focus? }`.
- `warp({ configDir, open })` writes each tab as a Warp Tab Config and opens it through its `warp://` link. Both options are injectable, which is how you test it.

## Requirements

- Node 22 or newer. ESM only: use `import`, not `require`.
- Command files are plain `.js` files (discovery loads `.js` only).

## Releasing

Agents cannot log in to npm or hold its token, so the owner does the first publish by hand and stores the npm token as a GitHub secret once.

1. Make sure the `@zjaaal` scope exists on npm (an npm user or organization named `zjaaal`). Merge the release PR. On a machine logged in to npm, from a clean checkout of `main`: `pnpm install --frozen-lockfile && pnpm run test:all && pnpm run build && npm publish --access public`. This creates `@zjaaal/artemis@0.1.0`. (Provenance is not available for a local publish; later releases get it.)
2. On npmjs.com create a granular access token that can publish `@zjaaal/artemis` (read and write, limited to that package, with an expiry), then store it as the repository secret: `gh secret set NPM_TOKEN --repo zJaaal/artemis`, or Settings, Secrets and variables, Actions, New repository secret, name `NPM_TOKEN`.
3. For each later release: bump `version` in `package.json`, commit, `git tag vX.Y.Z`, `git push origin main vX.Y.Z`. The workflow tests, builds and publishes with provenance.
4. Rotate the token before it expires: create a new one and overwrite the `NPM_TOKEN` secret.

## Development

```sh
pnpm install
pnpm run test:all      # tsc, eslint, prettier, vitest (including the type tests)
pnpm run build         # emits dist/ (JS and .d.ts)
pnpm run check-exports # after a build: the entry points resolve, nothing else does
pnpm run check-bin     # after a build: the packed art and artemis, run in temporary projects
pnpm run check-lock    # after a build: real processes racing for the registry lock
```

The code follows [docs/CODE_STANDARDS.md](docs/CODE_STANDARDS.md). Changes are specified in `specs/`.

## License

MIT
