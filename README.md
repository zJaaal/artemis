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

Agents write and run scripts all day: reset the database, start the dev stack, prune old data. Left to themselves, those scripts rarely have a `--help`, rarely ask before they delete anything, and leave no record of what ran.

Artemis is a small Node framework for those commands. One file in `commands/` is one command, and every command gets, without extra code, `--help`, one JSON result, exit codes that mean something, a confirmation before anything marked `destructive`, a dry run that does nothing, and a line in an audit file. The framework enforces them, so they hold for every command, including the ones an agent writes for itself, without anyone having to remember a rule.

```console
$ art db reset --json
{"ok":false,"command":"db reset","error":"art db reset changes or deletes data","hint":"Pass --yes to confirm. Pass --dry-run first to see what it would do."}

$ art db reset --dry-run --json
{"ok":true,"command":"db reset","result":null,"dryRun":true,"plan":["delete .data/db.json","run 5 migrations","load the seed"]}

$ art db reset --yes --json
{"ok":true,"command":"db reset","result":{"migrations":5,"seeded":true}}

$ art history
2026-11-14T03:29:45.981Z  db reset  exit 0
2026-11-14T03:29:45.912Z  db reset  dry run
2026-11-14T03:29:45.841Z  db reset  exit 1
```

The command behind it is one file. It says it is destructive and that it supports a dry run; the refusal, the plan and the record come from the framework:

```js
// commands/db/reset.js
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Delete the local database and rebuild it from migrations and the seed',
    destructive: true,
    dryRun: true,
    async run({ ctx }) {
        ctx.plan('delete .data/db.json');
        ctx.plan('run 5 migrations');
        ctx.plan('load the seed');
        if (ctx.dryRun) return null;

        // ...the real work
        return { migrations: 5, seeded: true };
    }
});
```

## Who it is for

- **Teams that let agents run jobs against real data.** Migrations, resets, cleanups, data fixes. A destructive command stops and asks, shows its plan first, and every run is in `art history`, so "what did the agent run last night?" has an answer.
- **Repos shared by several agents and people.** Claude Code, Cursor, Codex, an orchestrator or a teammate all find the same tools the same way, `art help --json --brief`, through a shell call. There is no server to run, and an orchestrator gets one JSON object and a meaningful exit code from every call.
- **Projects where agents build their own tooling.** Ask an agent to turn a job it keeps repeating into a command, and the command gets `--help`, the safety rules and a place in the listing, so the next agent can find and call it without reading its code.
- **Skills with steps that must not change.** A skill is instructions a model follows, and it can skip or change a step. Move the fixed steps into a command the skill calls, and keep the skill for the judgment.

It is not for one-off scripts, it will not lower your token bill, and it is not a sandbox (below).

## What to expect, and what not to

- **It does not save tokens on its own.** An agent calling Artemis commands spends about what it spends calling well-written scripts. A command saves work against doing a multi-step job by hand every time, because the steps are worked out once. Finding commands costs tokens too, more as you add them (`--search` and topics keep it down).
- **Scripts can be just as safe, if every one of them follows the same rules.** Agents that are given those rules in writing mostly follow them; agents that are not mostly skip them. The difference Artemis makes is that the rules are built in and checked, instead of a paragraph each project has to carry and each agent has to follow.
- **A confirmation stops accidents, not decisions.** An agent can pass `--yes` itself, and nothing in Artemis stops it from running a database client or `rm` directly. That is what [the permission settings](#keeping-agents-on-the-commands) are for.
- **Agents do not write commands unless asked.** The `SKILL.md` that `art skill` writes tells agents to turn a repeated job into a command; capable models sometimes act on it after doing the same job a few times, most do not. Ask for a command when you want one.
- **It is not a sandbox.** Commands run with your permissions, like any script. Review the ones an agent writes.

## Compared with what you might use instead

|                              | A `scripts/` folder       | An MCP server                    | A skill                        | Artemis                                       |
| ---------------------------- | ------------------------- | -------------------------------- | ------------------------------ | --------------------------------------------- |
| How an agent finds the tools | reads the files           | the tool list, over the protocol | it is loaded as instructions   | `art help --json --brief`, `--search`         |
| Confirmation and dry run     | whatever each script does | whatever each tool does          | the model may skip a step      | enforced for every command that declares them |
| What has to run              | a shell call              | a server process                 | the model, step by step        | a shell call                                  |
| An agent adding a tool       | easy, with no rules       | code in the server and a restart | easy, and the model follows it | one file, with the rules included             |
| Which agents can use it      | any with a shell          | clients that speak MCP           | clients that load skills       | any with a shell                              |
| Record of what ran           | none                      | whatever the server logs         | none                           | `art history`                                 |

Artemis is not an MCP implementation, and it works next to skills rather than instead of them: let a skill call commands for the fixed parts.

## How it is built

- **One file, one command.** Every folder is a group of commands, and there is no registry to keep up to date. Delete the file and the command is gone.
- **Machine-readable by default.** `help --json` lists every command with its arguments, flags, defaults, choices and examples. With `--json`, every call prints exactly one JSON object.
- **Honest exit codes.** `0` success, `1` the command failed, `2` the command line was wrong.
- **No prompt waits forever.** `--yes` and `--json` never prompt, and a question nobody can answer fails with a hint instead of waiting.
- **Typed.** `run({ args, flags })` is typed from the definition, even in plain JavaScript with `// @ts-check`.
- **Local.** Artemis sends nothing anywhere. What reaches the model is whatever a command returns, so return what the agent needs and not everything the command saw.
- **Small.** ESM only, Node 22 or newer, and one runtime dependency, [`@topcli/prompts`](https://github.com/TopCli/prompts), which has none of its own and is loaded only when a command asks a question.

## Quick start

```sh
npm install --save-dev @zjaaal/artemis   # or pnpm add -D: run it as `npx art`
npm install --global @zjaaal/artemis     # or anywhere: run it as `art`
```

The package gives two commands, `art` and `artemis`, the same file. There is no bin file to write.

**1. Make a folder a project.**

```console
$ npx art init
Created /work/my-project/package.json
Created /work/my-project/commands
Created /work/my-project/commands/hello.js
Created /work/my-project/AGENTS.md
Created /work/my-project/.gitignore
```

`init` creates a `package.json` (or adds the `artemis` key to yours, leaving the rest as it was), the `commands/` folder and a sample command, a short `## Commands` note for agents in `AGENTS.md` (and in `CLAUDE.md` when it does not import `AGENTS.md`) and an `audit*.jsonl` line in `.gitignore`. It never overwrites anything, running it again changes nothing, and it tells you if your `package.json` lacks `"type": "module"` (command files are ES modules). Without `init`, a `commands/` folder next to a `package.json` is all the convention needs.

**2. Run the sample, then write your own.**

```console
$ npx art hello
hello world

$ npx art hello --json
{"ok":true,"command":"hello","result":{"greeting":"hello world"}}

$ npx art help
```

A command is one file in `commands/`, with arguments and flags that `help` and `help --json` describe:

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

A global `art` works from any folder inside the project and needs no copy of Artemis there: `import ... from '@zjaaal/artemis'` in a command file resolves to the running copy, and a copy the project installed itself wins. `init`, `state`, `skill`, `doctor` and `history` are words of `art` itself, so a command file with one of those names cannot be run through it (`art doctor` tells you).

Where `art` looks for the project, its settings, and how to ship the same CLI under your own name: [Projects and settings](https://github.com/zJaaal/artemis/blob/main/docs/project.md).

## Keeping agents on the commands

A confirmation only protects what goes through a command. To make the commands the way your agent touches data, say so in its permission settings. In Claude Code, `.claude/settings.json`:

```json
{
    "permissions": {
        "allow": ["Bash(npx art:*)"],
        "deny": ["Bash(psql:*)", "Bash(dropdb:*)", "Bash(rm -rf:*)"]
    }
}
```

Other agents have their own allow and deny lists; the idea is the same. Deny rules match the start of a command line, so treat them as making the safe path the easy one, not as a wall.

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
- [Projects and settings](https://github.com/zJaaal/artemis/blob/main/docs/project.md): where `art` finds the project, the `artemis` settings, and shipping the CLI under your own name.
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
