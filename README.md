<h1 align="center">Artemis</h1>

<p align="center"><strong>A toolbox for the commands your agents run, instead of a pile of scripts.</strong></p>

<p align="center">
  <a href="https://github.com/zJaaal/artemis/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zJaaal/artemis/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen">
  <img alt="ESM only" src="https://img.shields.io/badge/module-ESM-blue">
  <img alt="Types included" src="https://img.shields.io/badge/types-included-blue">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-lightgrey">
</p>

> **Agents:** start with `art help --json --brief`; `art help --agents` prints the calling contract and `art help --authoring` how to write a command (or read [AGENTS.md](AGENTS.md)), the short version of this file.

Artemis is a small Node framework for the commands a project's people and AI agents run over and over: start the dev stack, reset the database, prune old data. One file in `commands/` is one command. Every command gets the parts that hand-written scripts usually skip, `--help`, one JSON result, exit codes that mean something, a confirmation before a command marked `destructive` and a dry run that does nothing. The author marks a command destructive once, in its definition, and from then on the framework enforces it, so no caller has to remember a rule.

```console
$ art db reset --json
{"ok":false,"command":"db reset","error":"art db reset changes or deletes data","hint":"Pass --yes to confirm. Pass --dry-run first to see what it would do."}

$ art db reset --dry-run --json
{"ok":true,"command":"db reset","result":null,"dryRun":true,"plan":["delete .data/db.json","run 5 migrations","load the seed"]}
```

## What you get

- **Safe defaults that are enforced, not requested.** A command marked `destructive` does not run without `--yes` when nobody is there to answer, and `--dry-run` only works on a command that declares it honors it. This holds for the commands an agent writes for itself, too.
- **One way to find tools.** `art help --json --brief` lists every command with how to call it, `art help --search "<words>"` finds the best few for a goal, and a large project folds into topics. A folder of scripts has to be read file by file.
- **Errors an agent can act on.** With `--json`, every call prints exactly one object; a failure carries a `hint` that says what to do, and the exit code says whether the command failed (`1`) or the call was wrong (`2`).
- **A record of what ran.** Every run is appended to an audit file: `art history` shows what ran, what was only previewed and what failed, and `art doctor` points out commands that keep failing.
- **Tools that outlive the session.** The next agent, or a teammate, finds and calls a command through `help`, without reading its code.

## What to expect, and what not to

- **It does not save tokens on its own.** An agent calling Artemis commands spends about what it spends calling well-written scripts. A command saves work against doing a multi-step job by hand every time, because the steps are worked out once. Finding commands costs tokens too, more as you add them (`--search` and topics keep it down).
- **Scripts can be just as safe, if every one of them follows the same rules.** Agents that are given those rules in writing mostly follow them; agents that are not mostly skip them (no `--help`, no confirmation before deleting). The difference Artemis makes is that the rules are built in and checked, instead of a paragraph each project has to carry and each agent has to follow.
- **A confirmation stops accidents, not decisions.** An agent can pass `--yes` itself, and nothing stops it from running a database client or `rm` directly. If some actions must only happen through a command, say so in your agent's permission settings (allow `npx art *`, deny the raw tools).
- **Agents do not write commands unless asked.** The `SKILL.md` that `art skill` writes tells agents to turn a repeated job into a command; capable models sometimes act on it after doing the same job a few times, most do not. Ask for a command when you want one.
- **It is not a sandbox.** Commands run with your permissions, like any script. Review the ones an agent writes.

Every file is a command, every folder is a group of commands, and there is no registry to keep up to date: Artemis finds whatever you drop in the folder. Everything an agent needs to call a command (arguments, flags, defaults, allowed values, examples) is machine-readable, and people get a normal CLI with `--help`.

```
commands/
  hello.js            ->  art hello
  db/
    _topic.js         ->  describes the "db" group
    migrate.js        ->  art db migrate
    reset.js          ->  art db reset
```

## Where it fits

- **Next to a skill, for the steps that never change.** A skill is instructions a model follows, and it can skip or change a step. A command runs the same steps every time. Keep skills for work that needs judgment, and let them call commands for the fixed parts.
- **Close to an MCP server, without the server.** Both give an agent tools with a name, a description and typed arguments. Here there is no server, no protocol and no process to keep running: a tool is a file, and calling it is a shell command. It is not an MCP implementation.
- **Local and private, with one caveat.** The work happens on your machine, with your files and credentials, and Artemis itself sends nothing anywhere. What reaches the model is whatever a command returns, so return what the agent needs and not everything the command saw.

## Why it is built this way

- **One file, one command.** No central list to edit. Delete the file and the command is gone.
- **Machine-readable by default.** `help --json` lists every command with its arguments, flags, defaults, choices and examples. With `--json`, every call prints exactly one JSON object.
- **Honest exit codes.** `0` success, `1` the command failed, `2` the command line was wrong.
- **No prompt waits forever.** `--yes` and `--json` never prompt, and a question nobody can answer fails with a hint instead of waiting.
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

`init` creates a `package.json` (or adds one line, the `artemis` key, to the one you have, leaving everything else as it was), the `commands/` folder and a sample command. It never overwrites anything, and running it again changes nothing. It also tells you if your `package.json` does not say `"type": "module"`: command files are ES modules, and without it Node prints a warning about each one on stderr. `init` takes no arguments, so go to the folder first (`--json` is the only flag; there is nothing to confirm). It also adds a short `## Commands` note for agents to `AGENTS.md` (and to `CLAUDE.md` when it has one that does not import `AGENTS.md`) and an `audit*.jsonl` line to `.gitignore`. (`init`, `state`, `skill`, `doctor` and `history` are words of `art` itself: a command file with one of those names cannot be run through `art`, and `art doctor` tells you if you have one.)

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
{
    "artemis": {
        "commandsDir": "tools/commands",
        "bin": "mytool",
        "stateDir": "data",
        "audit": false
    }
}
```

| Setting       | What it does                                                                                                          | Default                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `commandsDir` | The commands folder, relative to the folder of that `package.json`.                                                   | `commands`                                     |
| `bin`         | The name help and usage lines show.                                                                                   | `art` (see "Your own command name" for a tool) |
| `stateDir`    | Where the store kit keeps its documents, relative to that folder. Read by `art state` and `defineStore({ project })`. | `state`                                        |
| `audit`       | `false` stops `art` from appending each run to `audit.jsonl` in the state folder (what `art history` reads).          | `true`                                         |

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
    "dependencies": { "@zjaaal/artemis": "^1.2.0" }
}
```

`root` is where your bin file is: your tool runs **its own** `commands/`, wherever the user happens to be standing, not the commands of whatever project the user is in. It finds its package through the nearest `package.json` with a name, a `bin` or an `artemis` key, and never looks past its own folder in `node_modules`, so it never climbs into the project that installed it, even if you forgot to declare a `bin`. Make sure `commands/` ships with your package (check `files` in your `package.json`): a tool published without its commands fails with "Commands folder not found" and a hint for you, instead of running the commands of the project that installed it. Nothing is reserved for a tool: `init` and every other word is yours. Help and usage lines show `mytool`, taken from the single key of your `bin` object, or from your package name (without its `@scope/`) when `bin` is a plain string or has several keys, or from `"artemis": { "bin" }` if you set it. `cli` resolves to the exit code and never calls `process.exit`; it also takes `argv` and the host options of `run()` (`stdout`, `stderr`, `interactive`, `color`, `env`) if you need them.

### Full control

If you want to decide the commands folder, the streams or the exit code yourself, call `run()` from your own bin file. See [`run(argv, options)`](https://github.com/zJaaal/artemis/blob/main/docs/run.md).

## For agents

Everything an agent needs to call a command and to write one is in [AGENTS.md](AGENTS.md). An agent that only calls commands starts from `art help --json --brief` (ids, descriptions and how to call each one, `destructive` and `dryRun` marked; `art help --search "<words>"` finds the best few for a goal), then `art help <command> --json` for the one it needs; `art help --agents` prints that contract, with a global or a local install. To write a command or set a project up, `art help --authoring`. The short version:

- **Find, then call.** `help --json --brief`, then one command in full. Call with `--json` to get one object back, branch on the exit code, and read `hint` when `ok` is `false`.
- **Safety is data.** A `destructive` command needs `--yes` when nobody can answer, and fails before it runs otherwise. Where `dryRun` is marked, `--dry-run` shows the `plan` first.
- **The next step is in the result.** When a result has `next`, those are the commands to run next.
- **Quiet runs.** `--quiet` hides warnings and child output; `--log <file>` keeps everything in a file and names it in the envelope, and a failed child comes back with its `tail`.
- **A failed call says what is valid.** A usage error's `hint` is the command's usage and the global flags, and a failed child can come back with the `errorLines` its `errorPattern` matched.
- **`art history`** shows the recorded runs of your commands, **`art skill`** writes a short `SKILL.md` from them, and **`art doctor`** says why a stale install runs and which commands keep failing.

## Documentation

- [Commands](https://github.com/zJaaal/artemis/blob/main/docs/commands.md): how files become commands, and `defineCommand` in full.
- [Using the CLI](https://github.com/zJaaal/artemis/blob/main/docs/cli.md): global flags, help, the JSON contract, exit codes, `art state`, `art history`, prompts, `art skill` and `art doctor`.
- [`run(argv, options)`](https://github.com/zJaaal/artemis/blob/main/docs/run.md): full control of your own bin file, and testing your commands.
- Kits, opt-in pieces imported from their own subpath: [Store](https://github.com/zJaaal/artemis/blob/main/docs/kits/store.md), [Worktrees](https://github.com/zJaaal/artemis/blob/main/docs/kits/worktrees.md), [Terminal](https://github.com/zJaaal/artemis/blob/main/docs/kits/terminal.md).
- [Upgrading](https://github.com/zJaaal/artemis/blob/main/docs/upgrading.md): to 1.2 and 1.1, and from 0.1.

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
