<h1 align="center">🏹 Artemis</h1>

<p align="center"><strong>Every file an arrow. Every folder a quiver.</strong></p>

<p align="center">
  <a href="https://github.com/zJaaal/artemis/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zJaaal/artemis/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen">
  <img alt="ESM only" src="https://img.shields.io/badge/module-ESM-blue">
  <img alt="Types included" src="https://img.shields.io/badge/types-included-blue">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-lightgrey">
</p>

Artemis turns repetitive work into commands an AI agent can call, instead of steps it has to read and redo.

An agent that does the same job twice usually pays for it twice: it reads the instructions (a skill, a doc, a prompt), works out the steps, and runs them. With Artemis the agent writes the job down once, as one file in a folder. From then on it just calls it:

```console
$ art deploy staging --json
{"ok":true,"command":"deploy","result":{"url":"https://staging.example.com"}}
```

The script does the work, the same way every time. The agent spends tokens on the call and on the small result it reads back, not on re-reading instructions or re-deriving the steps. That is near zero, not zero: a run still costs the call and its result, and discovery (`help --json`) costs tokens in proportion to how many commands you have. What it saves is the repeated work itself.

Every file is a command, every folder is a group of commands, and there is no registry to keep up to date: Artemis hunts down whatever you drop in the folder. Everything an agent needs to call a command (arguments, flags, defaults, allowed values, examples) is machine-readable, and people get a normal CLI with `--help`.

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

## Where it fits

- **Instead of a skill, for work that is deterministic.** A skill is instructions a model reads and follows: it costs tokens each time it is loaded, and the model can still get a step wrong. If the steps are always the same, write them as a command and let the agent call it. Keep skills for work that needs judgment.
- **Like an MCP server, without the server.** The idea is the same: tools with a name, a description and typed arguments that an agent can discover (`help --json`) and call. The difference is that there is no server, no protocol and no process to keep running: a tool is a file, and calling it is a shell command. It is not an MCP implementation; an MCP adapter is possible later, but it is not part of this release.
- **Local and private, with one caveat.** The work happens on your machine, with your files and credentials, and Artemis itself sends nothing anywhere. What reaches the model is whatever a command returns, so return what the agent needs and not everything the command saw.
- **Commands are scripts.** They run with your permissions. Treat a command file like any script you run, and review the ones an agent writes.

## Why it is built this way

- **One file, one command.** No central list to edit. Delete the file and the command is gone.
- **Machine-readable by default.** `help --json` lists every command with its arguments, flags, defaults, choices and examples. With `--json`, every call prints exactly one JSON object.
- **Honest exit codes.** `0` success, `1` the command failed, `2` the command line was wrong.
- **Never hangs.** `--yes` and `--json` never prompt, and a prompt that nobody can answer fails with a hint instead of waiting forever.
- **Typed.** `run({ args, flags })` is typed from the definition, even in plain JavaScript with `// @ts-check`.
- **Small.** ESM only, Node 22 or newer, and one runtime dependency, [`@topcli/prompts`](https://github.com/TopCli/prompts), which has none of its own and is loaded only when a command asks a question.

## Install

```sh
pnpm add -D @zjaaal/artemis      # in a project: run it with `npx art`
# or: npm install --save-dev @zjaaal/artemis

npm install --global @zjaaal/artemis   # anywhere: run it as `art` (or `artemis`, the same command)
```

Installing the package puts two commands on your path, `art` and `artemis`. They are the same file, so use whichever you like.

## Quick start

No bin file, no boilerplate. Let `art init` set the project up, or do it by hand: a project is a `package.json` and a `commands/` folder next to it.

**1. Make a folder a project.**

```console
$ npx art init
Created /work/my-project/package.json
Created /work/my-project/commands
Created /work/my-project/commands/hello.js
```

`init` creates a `package.json` (or adds one line, the `artemis` key, to the one you have, leaving everything else as it was), the `commands/` folder and a sample command. It never overwrites anything, and running it again changes nothing. It also tells you if your `package.json` does not say `"type": "module"`: command files are ES modules, and without it Node prints a warning about each one on stderr. `init` takes no arguments, so go to the folder first (`--json` is the only flag; there is nothing to confirm). (`init` is reserved: a command file called `init.js` cannot be run through `art`, and `init` warns you if you have one.)

**2. Run the sample, then write your own.**

```console
$ npx art hello
hello world

$ npx art hello --json
{"ok":true,"command":"hello","result":{"greeting":"hello world"}}

$ npx art help
```

A command is one file in `commands/`:

```js
// commands/greet.js
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Greet someone, loudly if asked',
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

**By hand, with no `init`:** put your commands in a `commands/` folder next to a `package.json` and run `art`. That is all the convention needs.

If you installed it globally, drop the `npx` and run `art hello` from the project or any folder inside it. A globally installed `art` does not need a copy of Artemis in the project: it makes `import ... from '@zjaaal/artemis'` in your command files resolve to the copy that is running them. A copy the project installed itself always wins, and errors thrown by either copy keep their hint and exit code.

### How `art` finds your project

`art` looks at each `package.json` from the current folder up through its parents, and the **project** is the nearest one that says it is one, in either of two ways:

- **It declares itself**: it has an `"artemis"` key. This is what `art init` writes, and it is the explicit way: nothing is guessed.
- **It follows the convention**: it has a `commands/` folder next to it. This needs no setup.

Any other `package.json` is simply not a candidate and is skipped: a `{ "type": "module" }` file in `src/` or `dist/` (with or without other keys, such as `sideEffects`), a template, or a monorepo package that has neither. So `art` works from any folder inside your project, and a monorepo package without its own commands uses the root's. Two projects on one machine never see each other's commands.

All settings are optional, under the `artemis` key of that `package.json`:

```json
{ "artemis": { "commandsDir": "tools/commands", "bin": "mytool", "stateDir": "data" } }
```

| Setting       | What it does                                                                                                          | Default                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `commandsDir` | The commands folder, relative to the folder of that `package.json`.                                                   | `commands`                                     |
| `bin`         | The name help and usage lines show.                                                                                   | `art` (see "Your own command name" for a tool) |
| `stateDir`    | Where the store kit keeps its documents, relative to that folder. Read by `art state` and `defineStore({ project })`. | `state`                                        |

`art` always shows `art` (or your `bin` setting) in help, even in a project that publishes a CLI of its own, so what the help tells you to type is what you typed.

When it cannot find what to run, `art` exits `1` and says what to create or set, and with `--json` it prints the usual failure object with `command: null`:

| Problem                                                            | What the hint tells you                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no project from here upwards                                       | a project is the nearest `package.json` with an `artemis` key or a `commands/` folder next to it; run it inside one, or run `init` in this folder                                                                                             |
| the commands folder does not exist                                 | create it, set `"artemis": { "commandsDir" }`, or point it at a parent's commands (`"../commands"`)                                                                                                                                           |
| the `artemis` key has a bad shape                                  | the shape it should have                                                                                                                                                                                                                      |
| any `package.json` on the way up is not valid JSON or not readable | the file, and what is wrong with it. It is never skipped, because running a different project's commands silently would be worse (a deliberately broken fixture between you and the project makes `art` fail until you run it from elsewhere) |

### Your own command name

To ship the same CLI under your own name (say you publish a package `mytool`), give it a bin file:

```js
#!/usr/bin/env node
// bin/mytool.js
import { cli } from '@zjaaal/artemis/cli';

process.exitCode = await cli({ root: import.meta.url });
```

and point `package.json` at it, with `@zjaaal/artemis` as a dependency:

```json
{
    "name": "mytool",
    "type": "module",
    "bin": { "mytool": "bin/mytool.js" },
    "dependencies": { "@zjaaal/artemis": "^0.1.0" }
}
```

`root` is where your bin file is: your tool runs **its own** `commands/`, wherever the user happens to be standing, not the commands of whatever project the user is in. It finds its package through the nearest `package.json` with a name, a `bin` or an `artemis` key, and never looks past its own folder in `node_modules`, so it never climbs into the project that installed it, even if you forgot to declare a `bin`. Make sure `commands/` ships with your package (check `files` in your `package.json`): a tool published without its commands fails with "Commands folder not found" and a hint for you, instead of running the commands of the project that installed it. Nothing is reserved for a tool: `init` and every other word is yours. Help and usage lines show `mytool`, taken from the single key of your `bin` object, or from your package name (without its `@scope/`) when `bin` is a plain string or has several keys, or from `"artemis": { "bin" }` if you set it. `cli` resolves to the exit code and never calls `process.exit`; it also takes `argv` and the host options of `run()` (`stdout`, `stderr`, `interactive`, `color`, `env`) if you need them.

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

| Field                  | What it does                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.log(...)`         | Human output on stdout. **Silent under `--json`**, so stdout stays one JSON object.                                                                                                            |
| `ctx.warn(...)`        | Progress and warnings on stderr. Never mixes with `--json` output.                                                                                                                             |
| `ctx.prompt`           | Asks the user: `confirm`, `text`, `select` and `multiselect`, each returning the answer itself. When nobody can answer it throws a `CommandError` with `hint`. See "Prompts" below.            |
| `ctx.interactive`      | `true` only when a prompt may be shown. See "Prompts" below.                                                                                                                                   |
| `ctx.json`             | Whether the run was asked for `--json`.                                                                                                                                                        |
| `ctx.style`            | Color helpers (`bold`, `dim`, `red`, `green`, `yellow`, `cyan`); plain text when color is off.                                                                                                 |
| `ctx.commands`         | Every discovered command, for building lists of commands to run in order.                                                                                                                      |
| `ctx.invoke(id, argv)` | Runs another command by id or alias and returns its result. It inherits `--json` and `--yes`. A bad call (unknown command, wrong arguments, `--help`) fails the calling command with exit `1`. |

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
| `art help <topic> --json`           | the manifest narrowed to one topic: same shape, only its commands       |
| `art help <command> --json`         | the manifest entry of one command                                       |

On the shipped `art`, `help` also lists the words the binary handles itself (`init` and `state`) under **Built-in**, and `help --json` adds them as a top-level `builtins` array in the same shape as `commands`. `art help state` and `art help init` (with or without `--json`) describe them like a command, and a typo close to one suggests it. A tool published with its own bin file has no `builtins`.

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

### `art state`: see and reset what the app keeps

An app that keeps state (see the store kit below) keeps it in one folder, `"artemis": { "stateDir" }` in `package.json` (default `state`). `state` is a word of the shipped `art`, like `init`, so you and your agent can look at it without reading code:

```console
$ art state                       # list the documents: name, version, path
$ art state steps                 # show one (its JSON, the version wrapper included)
$ art state steps --reset         # delete it, so the app starts again from its defaults (asks first)
$ art state steps --reset --yes   # the same, with no question
```

- Under `--json` it prints one object: `{ dir, documents: [{ name, version, file }] }` for the list, `{ name, version, file, data }` for a document and `{ name, file, reset: true }` for a reset. A document that cannot be read is listed with `version: null` and an `error`, and a reset deletes it anyway.
- A reset never prompts under `--json` or without a terminal: without `--yes` it fails with the hint `Pass --yes to reset without a question.`
- A reset takes the document's lock, so it never removes a file in the middle of an update.
- An unknown document, or a name that could not be a document, exits `1` and lists the ones that exist. A wrong command line (a second argument, an unknown flag, `--reset` with no document) exits `2`.
- `state` only exists on the shipped `art` / `artemis`. A command of yours called `state` is hidden there, with a warning, and still runs through a tool published with `cli({ root })`.

### Prompts

`ctx.prompt` has four questions. Each returns the answer itself, so there is nothing to destructure:

```js
async run({ ctx }) {
    if (!ctx.interactive) return { confirmed: true };

    const confirmed = await ctx.prompt.confirm('Sure?'); // boolean; `initial: true` makes Return answer yes
    const name = await ctx.prompt.text('Name?', { initial: 'world' }); // string; Return answers `initial`

    const runner = await ctx.prompt.select('Runner?', {
        choices: [
            { label: 'Node', value: 'node', description: 'The default' },
            { label: 'Deno', value: 'deno' }
        ]
    }); // 'node' | 'deno' in TypeScript

    const steps = await ctx.prompt.multiselect('Steps?', {
        choices: [
            { label: 'Build', value: 'build', selected: true },
            { label: 'Test', value: 'test' }
        ]
    }); // ('build' | 'test')[]

    return { confirmed, name, runner, steps };
}
```

- In a terminal the user answers. Choice values are strings, and with literal choices TypeScript narrows the answer to their union (choices built at runtime give `string`).
- `--yes` and `--json` mean nobody can answer, so `ctx.interactive` is `false` and every question throws a `CommandError`. The same happens when there is no terminal (a pipe, an agent, CI).
- **`--yes` never answers a question with its default.** What `--yes` means is the command's decision: it reads `ctx.interactive` (or `flags.yes`) and skips the question, as in the example above. A `confirm` with `initial: true` still throws under `--yes`.
- The hint of that error says how to answer without a prompt. Pass your own: `ctx.prompt.confirm('Sure?', { hint: 'Pass --yes to accept the default.' })`. Without one, the hint says to pass `--yes`, or, when `--yes` or `--json` was already passed, that the command asks regardless and has to be answered with the flags it documents.
- Ctrl+C at a question fails the command with `Cancelled.` (exit `1`).
- The good pattern: check `ctx.interactive`, and fall back to flags, saved values or defaults when it is `false`.

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

### Store: `@zjaaal/artemis/store`

Safe, versioned JSON documents an app can keep between runs, and a lock for work that takes minutes. The kit models nobody's state: the app picks the folder, the names, the shapes and the defaults. The kit only guarantees **how a file is read and written**: atomically (a temporary file renamed into place, so a crash never leaves half a file), under a lock (so two processes updating at once cannot lose a write), with one clear error for a corrupt file.

```js
import { defineStore } from '@zjaaal/artemis/store';

const store = defineStore({ project: import.meta.url }); // the project's "artemis".stateDir (default "state")
const flags = store.doc('feature-flags', { fallback: { beta: false } });

flags.read(); // { beta: false } until something is written; always a fresh copy
flags.update((current) => ({ ...current, beta: true })); // read, change and write as one step under the lock
```

**Where the files go.** `defineStore({ project: import.meta.url })` uses `"artemis": { "stateDir" }` of the project that file belongs to, which is also what `art state` reads, so the app and the CLI cannot disagree. **`stateDir` and `project` are relative to the project root, but `defineStore({ dir })` is relative to the current folder**, so a relative `dir` moves with wherever the user runs the command. Use `project`, or build an absolute `dir` from `import.meta.url`. A published tool installed globally has no project of the user's to find: it passes `dir` itself.

A document is `<dir>/<name>.json`. A name is lowercase letters, digits and dashes (at most 64), anything else is a `TypeError`.

| `doc` method     | What it does                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read()`         | The document, with no lock. The `fallback` when the file does not exist: always a copy, so changing it changes nothing. Upgrades are applied in memory and never written. |
| `write(value)`   | Replaces the document, atomically, under the lock.                                                                                                                        |
| `update(change)` | `change(current)` returns the new value; read, change and write happen as one step under the lock. Returning `undefined` is a `TypeError` (a forgotten `return`).         |
| `locked(work)`   | Holds the lock for a read-modify-write that may write nothing. `work(doc)` can call `doc.write` and `doc.update`: the lock is reentrant inside one process.               |
| `reset()`        | Deletes the file, so the next read returns the fallback.                                                                                                                  |

`locked` and `update` take **synchronous work only**: a function that returns a promise is a `TypeError`, because the lock would be released before it settled. Long or async work goes in `store.lock`.

**Versions.** A document is plain JSON (version 0) unless it says otherwise, so every file you have today works as it is. From version 1 on the file is `{ "$version": n, "data": ... }`, and you give the steps that bring an older file up:

```js
const steps = store.doc('steps', {
    fallback: { order: [] },
    version: 2,
    upgrades: {
        1: (v0) => ({ order: v0.list ?? [] }), // keyed by the version each one produces
        2: (v1) => ({ ...v1, enabled: true })
    }
});
```

A file older than the code is upgraded in memory, one step at a time (a missing step is a `TypeError` when the document is defined). A file **newer** than the code is a `CommandError` with a hint, never a silent downgrade. A version-0 document whose value happens to be an object with a `"$version"` key is read as versioned: that key is Artemis's.

**Named locks, for long work.** `store.lock(name, work, { onWait, pollMs, timeoutMs })` runs `work` (sync or async) while holding `<dir>/<name>.lock`, waiting without blocking the process. `onWait({ pid })` is called once, when the lock is first found taken. A lock left by a process that died is taken over. Concurrent calls queue, in one process as across processes: `Promise.all([store.lock('build', a), store.lock('build', b)])` runs `a` then `b`. It is not reentrant: a call made from inside the work that holds the lock (even after an `await`) is a `CommandError` at once, not an endless wait.

```js
await store.lock(
    'build',
    async () => {
        await runTheBuild();
    },
    { onWait: ({ pid }) => console.log(`waiting for process ${pid}...`) }
);
```

**Corrupt files.** A document that is not valid JSON is a `CommandError` naming the file, with a hint to fix or delete it. `art state <doc> --reset` is how.

**In tests.** `createMemoryStore({ documents })` has the same API and never touches the disk. It holds JSON text, so copies and errors behave as on disk, and `documents` is what is "on disk" at the start (a versioned document is given wrapped).

```js
import { createMemoryStore } from '@zjaaal/artemis/store';

const store = createMemoryStore({ documents: { 'feature-flags': { beta: true } } });
```

Lock options (`now`, `isProcessAlive`, `pause`, `sleep`, `lockTimeoutMs`) go to `defineStore` so a test never sleeps.

### Worktrees: `@zjaaal/artemis/worktrees`

Give every checkout of a repo its own **instance**: a stable slot, ports shifted by that slot, and a color, so several copies of an app can run side by side. The main checkout is slot 0 and needs no registration; other worktrees register on first use and keep their slot until removed. The kit keeps nothing of its own: the app hands it the store document the registry lives in (`registry`).

```js
import { defineStore } from '@zjaaal/artemis/store';
import { defineWorktrees } from '@zjaaal/artemis/worktrees';

const store = defineStore({ project: import.meta.url });

const worktrees = defineWorktrees({
    registry: store.doc('instances', { fallback: {} }),
    mainCheckout: '/path/to/main/checkout',
    ports: { http: 8080, frontend: 4200 }
});

const instance = worktrees.ensure(); // registers the checkout you are in, on first use
instance.ports; // { http: 8180, frontend: 4300 } for slot 1
```

| Option         | What it is                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `registry`     | The store document the registry is kept in: `store.doc('instances', { fallback: {} })` (required).            |
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

Every write to the registry holds the document's lock file (`<dir>/instances.json.lock` for the example above), so several processes registering at once each get their own slot. A lock left by a process that died is taken over safely. How the lock waits (its clock, liveness check and timeout) is set on `defineStore`.

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

## Upgrading from 0.1

`1.0.0` changes three things, once.

**`ctx.prompt` is four methods that return the answer.** The question-object format of 0.1 and the two packages behind it (the prompt library and its optional types peer dependency) are gone:

| 0.1                                                                                         | 1.0                                                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `const { ok } = await ctx.prompt({ type: 'confirm', name: 'ok', message })`                 | `const ok = await ctx.prompt.confirm(message)`                               |
| `ctx.prompt({ type: 'text', name, message, initial })`                                      | `ctx.prompt.text(message, { initial })`                                      |
| `ctx.prompt({ type: 'select', name, message, choices: [{ title, value }] })`                | `ctx.prompt.select(message, { choices: [{ label, value }] })`                |
| `ctx.prompt({ type: 'multiselect', name, message, choices: [{ title, value, selected }] })` | `ctx.prompt.multiselect(message, { choices: [{ label, value, selected }] })` |
| `ctx.prompt(question, { hint })`                                                            | the same `{ hint }` goes in the options of each method                       |

Choice values are strings. Calling `ctx.prompt(...)` the old way fails with JavaScript's own `ctx.prompt is not a function`, and TypeScript and `// @ts-check` show it at compile time. If your project listed that types package only for Artemis, remove it.

**The worktrees kit takes a document, not a file.** `stateFile: path` becomes `registry: defineStore({ dir }).doc(name, { fallback: {} })`, where `dir` is the old file's folder and `name` is its file name without `.json`. That is the same file, the same content and the same lock file, so a `0.1` process and a `1.0` process running at once still exclude each other. If the old file name is not a valid document name (`Instances.json`) or you want another name, rename the file while nothing runs. The lock options (`now`, `isProcessAlive`, `pause`, `lockTimeoutMs`) move from `defineWorktrees` to `defineStore`.

```js
// 0.1
defineWorktrees({ stateFile: '/app/data/instances.json', mainCheckout, ports });

// 1.0
const store = defineStore({ dir: '/app/data' });

defineWorktrees({ registry: store.doc('instances', { fallback: {} }), mainCheckout, ports });
```

**New:** the store kit, `art state` and the `"artemis": { "stateDir" }` setting. Nothing to change for them.

## Requirements

- Node 22 or newer. ESM only: use `import`, not `require`.
- Command files are plain `.js` files (discovery loads `.js` only).

## Development

```sh
pnpm install
pnpm run test:all      # tsc, eslint, prettier, vitest (including the type tests)
pnpm run build         # emits dist/ (JS and .d.ts)
pnpm run check-exports # after a build: the entry points resolve, nothing else does
pnpm run check-bin     # after a build: the packed art and artemis, run in temporary projects
pnpm run check-lock    # after a build: real processes racing for the registry, a document and a named lock
```

The code follows [docs/CODE_STANDARDS.md](docs/CODE_STANDARDS.md). Changes are specified in `specs/`.

## License

MIT
