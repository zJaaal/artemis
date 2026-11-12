# SPEC 03 — Agent economy: cheaper discovery, safety as data, next steps, quiet runs, a generated skill, a doctor, and failures that name their cause

> **Status:** Approved
> **Depends on:** SPEC 02 (merged in `b084a02`)
> **Date:** 2026-11-11 (revised 2026-11-12)
> **Objective:** Cut the tokens an agent spends to find, call and follow Artemis commands safely, and to trace failures back to their cause, by putting discovery levels, destructive and dry-run markers, next steps, output control, a generated skill, a version doctor, port-base checks, lock labels and the shipped agent doc into the contract instead of into prose.

## Why this spec exists

Artemis's pitch is that a command saves an agent the tokens of redoing work by hand. A benchmark on the scripts repo ("hard" task: start a dotCMS instance for a worktree and wait for it) showed where that saving leaks. The agent using `art` lost its token advantage to **reading**, not to running:

- **Discovery read too much.** `art dotcms help --json` is 8.8 KB, and the agent needed one command. The single-command level already exists (`art help dotcms start --json` and `art dotcms start --help --json` both return one entry, 392 bytes on the fixture `hello`), but nothing tells an agent to go there, and there is no level between "everything about every command" and "one command".
- **Safety rules are prose.** The scripts repo's `AGENTS.md` lists in sentences which commands destroy data (`dotcms prune`, `dotcms remove`), and each of those commands writes its own `ctx.prompt` confirm. An agent has to read a page to stay safe, and nothing enforces the page.
- **The next step is guessed.** Several of the agent's 16 turns went to working out what to run after `dotcms start` succeeded (`ART_INSTANCE=bench-art art dotcms wait --json`). Errors already carry a `hint`; successes carry nothing.
- **Progress floods the context.** `lib/docker.js` runs Maven and Docker with `spawn(command, args, { stdio: 'inherit' })`, so their output never passes through Artemis. A Maven build or a `pnpm install` is thousands of lines, and an agent reading stderr pays for all of them.
- **The agent doc drifts.** Prose about the CLI is written by hand and goes stale. Everything it needs to say is already in the manifest.
- **A stale install runs silently.** `art` kept running an old `0.1.1` while the project expected newer; nothing warned.
- **A wait names a process, not a job.** Before the store kit, the scripts repo's own lock said which folder's build it was waiting for. Spec 02's named lock reports only a pid ("process 80676"), so an agent waiting on a build has to find out what that process is.
- **The agent doc does not ship.** The README is about 700 lines (47 KB, roughly 12k tokens): thorough for people, costly for an agent to read in full. AGENTS.md is the short version (91 lines, roughly 3k tokens), but the package publishes only `dist/`, README, LICENSE and `package.json`, so an agent in an app's repo never finds it.
- **A configuration mistake surfaces as someone else's error.** Two port bases of the worktrees kit that land on the same port in different slots fail only when those two slots run at once, as a Docker bind error several layers below the mistake (below).

This spec puts each of those into the contract that agents already read (`help --json`, the `--json` envelope, exit codes), so the saving comes back without new prose. The owner chose one spec (2026-11-11): every item costs an agent tokens around a command, either reading before the call or tracing a failure after it, and they ship as one release.

### Worktrees kit: port bases that collide across slots

Found by an agent on 2026-11-11, running `art` in the scripts repo. It started three image instances at once (slots 2, 3 and 4) while the main instance (slot 0) was running. Slot 4 failed with "docker compose up exited with code 1": its Elasticsearch container could not bind host port 9600.

The kit gives every port `base + slot * slotStep` (default step 100). The app passed `elasticsearch: 9200` and `elasticsearchPerf: 9600`. These bases are 400 apart, a multiple of the step, so their series meet: slot 4's `elasticsearch` is 9200 + 400 = 9600, which is slot 0's `elasticsearchPerf`, and the same holds for slots N and N + 4, for every N. The kit did what it was told. Nothing checks that the bases an app passes stay apart across slots, so the mistake only shows up when two particular slots run at the same time, and then as a bind error deep in Docker that an agent has to trace back by hand.

The app has worked around it (`elasticsearchPerf: 9650` in its `lib/instances.js`; a brute-force check of slots 0 to 30 finds no clash). This spec makes the kit refuse such bases when the app loads, before any instance exists, with an error that names the keys. The kit puts no limit on slots today, so a rule with no limit would also refuse pairs that only meet very far apart: the scripts repo's own set has 9200 and 4200, 50 slots apart (5000 / 100), which its check of slots 0 to 30 never reached. So the kit gains a slot limit, `maxSlots`, and refuses only the pairs that can meet below it.

The same incident raises two clashes no arithmetic on the bases can see: a port already used on the machine by other software (the scripts repo's slot 0 is 5432, the standard Postgres port), and ports the operating system treats specially (below 1024 needs root on Linux; 49152 to 65535 is where macOS and Windows pick temporary ports for outgoing connections). The bases are checked against both ranges when the app loads, and a new slot is checked against the ports in use when it is given out.

A `flags apply` startup step also failed once in the same run. It could not be reproduced (10 concurrent runs passed), the dotCMS logs show nothing, and it has nothing to do with ports or the kit. It is not part of this spec.

## Scope

**In:**

- `help --json --brief` (and `help <topic> --json --brief`): ids and one-line descriptions only.
- `destructive: true` on a command definition: shown in the manifest and enforced. It asks in a terminal and needs `--yes` when nobody can answer.
- `dryRun: true` on a command definition, a global `--dry-run`, `ctx.dryRun` and `ctx.plan(step)`, and `plan` in the envelope. `--dry-run` on a command that does not support it is a usage error.
- `ctx.next(...lines)` (each line is what follows the bin, which Artemis adds) and `next` in the success envelope.
- `ctx.exec(command, args, options)` (with `readOnly` for calls that must run even under `--dry-run`), the global `--quiet` and `--log <file>`, `log` in both envelopes, and `tail` (the last lines of a failed child) in the failure envelope.
- `art skill [--write <path>]`, a built-in word that generates a short `SKILL.md` from the manifest.
- `art help --agents`, which prints the AGENTS.md of the running copy, so an agent finds it with a global or a local install.
- `art doctor`, a built-in word that checks the install and the project and gives a fix for each problem, plus a one-line version warning when a command or `help` runs on the shipped binary.
- `maxSlots` on `defineWorktrees` (default `DEFAULT_MAX_SLOTS = 20`, slot 0 included): `ensure` and `ensureDetached` refuse to give out a slot past it. `defineWorktrees` refuses port bases that meet in two slots below the limit, any slot port outside 1024 to 49151, and a `slotStep` or `maxSlots` that is not a whole number greater than 0, with a `TypeError` that names the keys.
- When `ensure` or `ensureDetached` gives out a new slot, it skips a slot any of whose ports is already in use on the machine (checked like Vite does, on all interfaces), through an injectable `portsInUse` option.
- `label` on `store.lock`: a short line written into the named lock, shown to whoever waits and in the "is locked" error.
- AGENTS.md ships in the package, the README points agents to it first, and the generated skill points to it (through `help --agents`) for writing commands. Its "Working on Artemis itself" section moves to `CONTRIBUTING.md`, which does not ship, and a repository `CLAUDE.md` (not shipped either) loads both files, so agents working on Artemis still get the binding rules automatically.
- README, AGENTS.md, CONTRIBUTING.md, CLAUDE.md, `check-bin`, `check-lock`.

**Out of scope (for future specs):**

- Kits that ship commands (`list` and `remove` for the worktrees kit). It changes discovery, so it gets its own spec.
- The store kit, which is spec 02.
- `state`, `skill` and `doctor` on a published tool's own CLI (`cli({ root })`). See Decisions.
- Static next steps declared in a definition (`next: [...]` in `defineCommand`). `ctx.next` is enough until a command needs both.
- A full semver range parser. The version check understands the common forms and says "not checked" for the rest.
- Streaming progress events (structured progress in `--json`). `--quiet` and `--log` cover the token cost.
- Migrating the scripts repo onto `destructive`, `ctx.exec` and `ctx.next` (its own spec in that repo).
- A `readOnly` marker on command definitions (see Decisions).
- Forwarding SIGTERM sent to Artemis itself to its children (see Risks).

## Data model

Types live in `src/models.ts`. Constants live in `src/constants.ts`.

```ts
// CommandDefinition gains two optional fields (both still pass the extra-field rule untouched otherwise):
export type CommandDefinition<TArgs, TFlags> = {
    // ...everything from spec 01
    destructive?: boolean; // changes or deletes data the user cannot get back. Default false
    dryRun?: boolean; // the command honors ctx.dryRun: it reports what it would do and does none of it. Default false
};
// Both must be booleans when present: defineCommand throws a TypeError for `destructive: 'yes'`, `dryRun: 1`
// and the like, as it does for the other rules.

// ctx gains:
export type CommandContext = {
    // ...json, interactive, style, log, warn, prompt (spec 02), commands, invoke
    dryRun: boolean; // --dry-run was passed (only ever true for a command with dryRun: true)
    quiet: boolean; // --quiet was passed
    next: NextFn; // suggest what to run after this succeeds
    plan: PlanFn; // under --dry-run: describe one thing the command would do
    exec: ExecFn; // run a child process whose output follows --quiet, --log and --json
};
export type NextFn = (...lines: string[]) => void; // what follows the bin ('dotcms wait --instance x --json'); Artemis adds '<bin> '
export type PlanFn = (step: string) => void; // a no-op outside --dry-run

export type ExecFn = (command: string, args?: readonly string[], options?: ExecOptions) => Promise<ExecResult>;
export type ExecOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv; // default: the process environment
    capture?: boolean; // return the output instead of showing it (git rev-parse, docker ps). Default false
    readOnly?: boolean; // the call changes nothing, so it runs even under --dry-run. Implies capture. Default false
    reject?: boolean; // a non-zero exit throws. Default true. A timeout throws regardless
    timeoutMs?: number; // kill the child (SIGTERM, then SIGKILL after EXEC_KILL_GRACE_MS) and throw. Default: none
};
export type ExecResult = {
    code: number; // 0 when skipped under --dry-run
    output: string; // stdout and stderr interleaved, in every piped mode (not only capture); '' when the output was shown on the terminal (inherit mode) or skipped
    skipped: boolean; // true under --dry-run for a call without readOnly: nothing ran
};
```

Global flags (`GLOBAL_FLAGS`) grow from `help`, `json`, `yes` to:

```ts
'dry-run': { type: 'boolean', description: 'Say what the command would do, and do none of it' },
quiet: { type: 'boolean', description: 'Hide warnings, Next: lines, the version warning and child output; the result and errors still print' },
log: { type: 'string', description: 'Write everything the command and its child processes print to this file' },
```

`dry-run`, `quiet` and `log` become reserved: `defineCommand` throws a `TypeError` for a command that declares any of them, as it does for `help`, `json` and `yes`. No short forms are added (`-q` and `-n` stay free for commands). `--brief` and `--agents` are not global. They are flags of the `help` word only, and anywhere else they stay unknown flags (exit 2), as today.

`--log` parses like every string flag of spec 01: `--log file` and `--log=file` are the same, a repeated `--log` keeps the last value, and the word after `--log` is always its value, so `art --log hello` means the log file `hello` and no command. That is a `UsageError` (exit 2), because `--log` means nothing without a command and the help word does not take it (below).

The built-in words take the new global flags as follows. `--quiet` is accepted by `init`, `state`, `skill`, `doctor` and `help`, where it hides warnings. `--dry-run` and `--log` on any built-in word are a `UsageError` (exit 2), like any other flag a word does not take, because none of them runs `ctx.exec` or has a plan to show. `--log` with no command (`art --log hello`, `art help --log x`) is a `UsageError` too; its wording is not fixed.

The envelope. New keys come after the spec 01 keys, always in this order: `ok`, `command`, `result` or `error`, `hint`, then `dryRun`, `plan`, `next`, `log`, `tail`, `checks`.

```jsonc
// success
{ "ok": true, "command": "dotcms start", "result": { "instance": "bench-art" },
  "next": ["art dotcms wait --instance bench-art --json"],    // ctx.next, with the bin added
  "log": "/abs/start.log" }                                    // --log
// success under --dry-run
{ "ok": true, "command": "dotcms prune", "result": { ... }, "dryRun": true,
  "plan": ["docker volume rm dotcms-bench-art_dbdata", "remove data/compose-dotcms-bench-art.yml"] }
// failure of a child run through ctx.exec
{ "ok": false, "command": "dotcms build", "error": "mvn exited with code 1",
  "hint": "Full log: /abs/build.log", "log": "/abs/build.log",
  "tail": ["[ERROR] Failed to execute goal ...", "..."] }      // last EXEC_TAIL_LINES lines, each cut at EXEC_TAIL_LINE_CHARS
```

When each key exists:

- `dryRun: true` and `plan` exist on every success under `--dry-run`, and only then. `plan` is `[]` when nothing was planned, so an agent can always tell a dry run from a real one.
- `next` exists on success when `ctx.next` collected at least one line, under `--dry-run` too (the command decides what it suggests then; it can read `ctx.dryRun`).
- `log` exists on success and failure whenever the `--log` file was opened. When opening it failed, there is no `log` key.
- `tail` exists only on a failure that came from `ctx.exec` with at least one line of output.
- `checks` exists only on a failing `art doctor` (below).

Keys spec 01 defined (`ok`, `command`, `result`, `error`, `hint`) keep their names and order.

The manifest:

```jsonc
// every command entry of the full manifest gains two booleans, always present:
{ "id": "dotcms prune", "description": "...", "usage": "...", "aliases": [], "args": [], "flags": [], "examples": [],
  "destructive": true, "dryRun": true }

// help --json --brief  (help <topic> --json --brief narrows it the same way)
{ "ok": true, "command": "help", "result": {
    "bin": "art",
    "topics": [{ "id": "dotcms", "description": "Run dotCMS instances" }],
    "commands": [
        { "id": "dotcms start", "description": "Start the instance of this worktree" },
        { "id": "dotcms prune", "description": "Delete an instance's data", "destructive": true, "dryRun": true }
    ],
    "builtins": [{ "id": "state", "description": "..." }],     // shipped route only, as in spec 02
    "more": "art help <command> --json"                        // how to get one entry in full
} }
```

The brief form has no `usage`, `args`, `flags`, `examples`, `aliases` or `globalFlags`. `destructive` and `dryRun` appear only when true, because they are the two facts an agent must not miss before calling.

- `topics` lists every topic at any depth that has a command in the listing, by its full id (`dotcms`, `dotcms db`), in the order of the full manifest, with the `_topic.js` description or `""`.
- `builtins` entries are `id` and `description` only. A built-in word is never marked `destructive`: `state --reset` and `skill --write` ask on their own (below).
- `help <command> --json --brief` is a `UsageError` (exit 2), "--brief lists commands; drop it to see <command> in full". One command is already the small level, and a brief entry of one command would hide the args an agent came for.
- There is no byte budget. The saving comes from the keys a brief entry is allowed to have, and tests pin those. The Handoff report gives both sizes on the fixture tree for the record.

`art help --agents` prints the AGENTS.md that ships beside the running copy's `dist/`, as is, to stdout. Under `--json` it prints `{ ok: true, command: "help", result: { file, markdown } }`. It reads the running copy, never the project's, so it works with a global `art` and no local install. It is available on the shipped route and on a published tool's CLI (it documents Artemis, not the tool). It takes `--json`, and `--quiet`, which changes nothing because it has no warnings. With a topic or a command, or with `--brief`, it is a `UsageError` (exit 2). A package missing its AGENTS.md (a broken install) fails with exit 1, hint "Reinstall @zjaaal/artemis."

`art doctor`:

```ts
export type DoctorCheck = {
    id: 'version' | 'range' | 'installed' | 'project' | 'module' | 'commands' | 'words' | 'state';
    status: 'ok' | 'warn' | 'fail';
    message: string;
    fix?: string; // what to run or change; present on warn and fail
};
// art doctor --json, nothing failed (warnings allowed), exit 0:
//   { ok: true, command: "doctor", result: { version, checks: DoctorCheck[] } }
// art doctor --json, one or more failed, exit 1:
//   { ok: false, command: "doctor", error: "1 check failed" | "N checks failed", hint: <the first failing check's fix>,
//     checks: DoctorCheck[] }
```

A failing doctor keeps its checks. Spec 01's failure envelope has no `result`, so the list goes in the `checks` key, which exists only there, the same way `tail` exists only on an exec failure. An agent gets every fix in one call. In text mode the checks print one per line with their status, then the error.

With no project found, the checks are `version`, `project` (`fail`) and `installed` (from the current folder, which is `ok` when there is no copy). The checks that need a project (`range`, `module`, `commands`, `words`, `state`) are left out, not reported as failing.

The every-run version warning never prints on a run of `art doctor`, which reports the same facts as checks.

The checks, in order:

| id | What it checks | warn / fail |
| --- | --- | --- |
| `version` | The version of the Artemis that is running (its own `package.json`) | always `ok`, informational |
| `range` | The project's `dependencies` or `devDependencies` range for `@zjaaal/artemis` against the running version | `warn` when not satisfied; `ok` with "not checked: <range>" for forms the checker does not understand; `ok` when the project does not depend on Artemis |
| `installed` | The project's own copy of `@zjaaal/artemis`, found the way Node resolves a package from the project root (each `node_modules` upwards, so a hoisted monorepo or pnpm layout is found), against the running version | `warn` when they differ: "a global art 0.1.1 is running; this project installs 1.1.0", fix "Run npx art, or update the global art." `ok` "not installed in this project; running <version> from <path>" when no copy is found. `ok` when the copy found is the running one |
| `project` | A project is found, and which `package.json` it is | `fail` when none |
| `module` | `"type": "module"` in that `package.json` | `warn` |
| `commands` | The commands folder exists, every file loads and no alias is already taken (every discovery warning listed) | `fail` |
| `words` | No project command or topic is called like a built-in word (`init`, `state`, `skill`, `doctor`), which the word would hide (`shadowsWord`, spec 02) | `warn` naming each hidden one, fix "Rename commands/<word>.js; art <word> runs the built-in." |
| `state` | `stateDir` (spec 02): exists or not (`ok` either way), and every document parses (`inspectDocument`) | `warn` per unreadable document, fix "art state <doc> --reset" |

The every-run warning is `range` and `installed` only. They are cheap: the project's `package.json` is already read, plus one `package.json` from `node_modules`. It runs on the shipped route when a command or `help` runs, not on the built-in words `init`, `state`, `skill` and `doctor` (`doctor` reports the same facts as checks, and the others are about the project's files, not its commands), and prints **one line** to stderr however many of the two warn. When both warn, the line names both ("art 0.1.1 is running; this project wants ^1.1.0 and installs 1.1.0. Run art doctor."). It is never part of the JSON envelope, so stdout stays one object. `--quiet` hides it, and it names `art doctor` for details.

Version ranges (`src/utils/semver.ts`, pure) follow npm's meaning for the forms they understand:

- Exact `1.2.3`, with an optional leading `v` or `=` (both stripped).
- `^1.2.3` (`>=1.2.3 <2.0.0`), and on 0.x the caret pins what is left of the first non-zero part: `^0.1.2` is `>=0.1.2 <0.2.0`, and `^0.0.3` is `>=0.0.3 <0.0.4`. The incident was 0.1.x, so this case is tested.
- `~1.2.3` (`>=1.2.3 <1.3.0`).
- `>=`, `>`, `<=` and `<` with a full version.
- `*`, `x`-ranges (`1.x`, `1.2.x`, `1.2.*`), and partials, which mean the same as their x-range (`1`, `1.2`, `^1` = `>=1.0.0 <2.0.0`, `~1.2` = `1.2.x`).
- `^0` (`<1.0.0`) and `^0.0` (`<0.1.0`), as npm reads them. `X` and `x` are the same.
- `||` between any of those, with or without spaces around it (`^1 || ^2`).

Any other form is "not checked", never a warning: `workspace:`, `file:`, `link:`, a git URL, a tag, a space-joined range (`>=1.2.3 <2`, meaning both at once), a hyphen range, a range with a prerelease, and a comparison operator with a partial version (`>=1`). A **running** version that is a prerelease (`1.1.0-beta.1`) is not checked against any range either: `range` reports `ok` "not checked: running a prerelease". `installed` compares exact strings, so it still warns when the two copies differ.

`art skill`:

```
art skill [--write <path>] [--yes] [--json] [--help]
```

It prints a `SKILL.md` built from the manifest to stdout, or writes it to `<path>`, creating missing parent folders (`.claude/skills/art/SKILL.md` usually does not exist yet). It never overwrites a file without asking: in a terminal it asks, and otherwise it needs `--yes` (the reset rule of spec 02, hint "Pass --yes to overwrite <path>."). Declining the question prints "Not written: <path> is unchanged." and exits 0, as declining a reset does. Under `--json` the result is `{ markdown }`, or `{ file }` with `--write`. When a project command or topic called `skill` is hidden by the word, it prints the spec 02 shadow warning to stderr, as `state` does. Its content is fixed and short:

```markdown
---
name: <bin>
description: "Use the <bin> CLI of <package name> instead of doing these tasks by hand. <package description>"
---

# <bin>

- Find commands: `<bin> help --json --brief`. One command in full: `<bin> help <command> --json`.
- Call with `--json`: one object on stdout. `ok: false` has `error` and often `hint`: do what the hint says.
- Exit codes: 0 ok, 1 the command failed, 2 the command line was wrong.
- Nothing prompts with `--yes` or `--json`. A destructive command needs `--yes`.
- When a result has `next`, those are the commands to run next.
- Long output: add `--quiet`, or `--log <file>` to keep the full output in a file.
- To add a command: `<bin> help --agents`.

## Destructive (need `--yes`; try `--dry-run` first where marked)

- `<bin> dotcms prune`: Delete an instance's data (`--dry-run`)
- ...

## Examples

- `<bin> dotcms start`
- ... (the definitions' `examples`, at most SKILL_MAX_EXAMPLES)
```

The destructive section is left out when no command is destructive, and the examples section when none has examples. No usage lines, args or flags: the skill points at `help <command> --json` for those, so it stays short and never goes stale.

How it is filled:

- `name` is the bin. `<package name>` is the project's `package.json` `name`. Without one, the sentence reads "Use the <bin> CLI instead of doing these tasks by hand.". `<package description>` is its `description`, left out when there is none.
- `description` is always written as a YAML double-quoted string, escaped with `JSON.stringify` (a JSON string is a valid YAML scalar), with line breaks in the package description folded into spaces, so a `:`, a quote or a newline cannot break the frontmatter.
- Examples come in manifest order (commands, then each command's own `examples` in their order), the first `SKILL_MAX_EXAMPLES`. Each is the definition's example as written with `<bin> ` in front, as `help` already shows it. Nothing is appended: the bullets above already tell the agent to add `--json`.

Constants (`src/constants.ts`): `EXEC_TAIL_LINES = 40`, `EXEC_TAIL_LINE_CHARS = 500`, `EXEC_KILL_GRACE_MS = 5000`, `SKILL_MAX_EXAMPLES = 10`, `ARTEMIS_PACKAGE = '@zjaaal/artemis'`, `AGENTS_FILE = 'AGENTS.md'`. `SKILL_WORD = 'skill'` and `DOCTOR_WORD = 'doctor'` go in `src/cli/constants.ts` beside the words `init` and `state` already use. In the worktrees kit's `constants.ts`: `DEFAULT_MAX_SLOTS = 20`, `MIN_SLOT_PORT = 1024`, `MAX_SLOT_PORT = 49151`, `PORT_PROBE_TIMEOUT_MS = 5000`. In the store kit's: `LOCK_LABEL_MAX_LENGTH = 120`.

New files:

```
src/edges/exec.ts            spawn (never a shell), the only place a child process starts for ctx.exec
src/edges/log-file.ts        opens, appends to and closes the --log file
src/context/exec.ts          pure decisions: inherit or pipe, what to echo where, the tail ring
src/utils/semver.ts          pure: parse a version, test it against the supported range forms
src/cli/doctor.ts            pure: the checks from what the edges read
src/cli/doctor-command.ts    `art doctor`
src/cli/version-warning.ts   the every-run warning (range + installed)
src/cli/skill.ts             pure: the markdown from a manifest and the project's package.json
src/cli/skill-command.ts     `art skill`
src/kits/worktrees/ports.ts       pure: the port-base and range checks
src/kits/worktrees/port-edges.ts  the default portsInUse probe (spawnSync)
CONTRIBUTING.md              "Working on Artemis itself", moved out of AGENTS.md; not shipped
CLAUDE.md                    imports @CONTRIBUTING.md (and @AGENTS.md, see Behavior); not shipped
```

Files that change for the two new words, beside `launch.ts`: `src/cli/shadow.ts` callers (the hidden-word warning), `src/cli/word-help.ts` (`art skill --help`, `art doctor --help`), the `builtins` list in the manifest, and the unknown-command suggestions, all of which list `init` and `state` today.

## Behavior

**Order before `run`.** For a resolved command, the checks run in this order, and the first one that fires decides the outcome:

1. Parsing: an unknown flag, a missing or extra argument, a bad `choices` value (exit 2, as spec 01).
2. `--help`: the command's help is printed and nothing else happens (exit 0). It wins over everything below, so `--help --dry-run` on a command without dry-run support shows the help.
3. `--dry-run` on a command without `dryRun: true` (exit 2).
4. The destructive check, below (exit 1 on refusal or "no").
5. Opening the `--log` file (exit 1 when it cannot be opened). It comes after the confirmation, so a cancelled destructive run leaves an existing log file as it was.
6. `run`.

**`destructive`.** Before `run` starts, `run()` checks a destructive command:

- under `--dry-run`, nothing is asked, because nothing will be changed;
- with `--yes`, it runs;
- interactive (spec 01's rule: a terminal, and neither `--json` nor `--yes`): it asks through the spec 02 `confirm`, "<bin> <id> changes or deletes data that cannot be recovered. Continue?", default no. Declining is `CommandError` "Cancelled." (exit 1);
- otherwise it fails before `run` with `CommandError` "<bin> <id> changes or deletes data", hint "Pass --yes to confirm." and, when the command supports dry runs, "Pass --dry-run first to see what it would do." (exit 1).

`ctx.invoke` of a destructive command passes the caller's `--yes` and `--dry-run` along, as spec 01 passes `--yes`. Without them, it asks again or fails the caller: a confirmation covers the command the user named, not the ones it calls.

**`--dry-run`.** It is valid only for a command with `dryRun: true`. On any other it is a `UsageError` "<id> does not support --dry-run" (exit 2), so nothing runs by surprise. Under it:

- `ctx.dryRun` is true, and `ctx.plan(step)` collects steps.
- `ctx.exec` without `readOnly` does not start the child. It adds "<command> <args...>" to the plan, followed by " (in <cwd>)" only when `options.cwd` was given, and returns `{ code: 0, output: '', skipped: true }`. The arguments appear as they were passed. The README notes that a plan line, like `tail` and `--log`, holds arguments as is, so a secret passed as an argument shows up there.
- `ctx.exec` with `readOnly: true` runs the child for real, captured (it implies `capture`), adds nothing to the plan, and returns `skipped: false`. It is how a dry-runnable command reads `git rev-parse` or `docker ps` to decide what it would do. The author vouches that the call changes nothing; Artemis cannot check it.
- The envelope gets `dryRun: true` and `plan` (`[]` when empty). In text mode the plan is printed to stdout as a list after the command's own output, or "Nothing to do." when empty. The plan is the result of a dry run, so `--quiet` never hides it.
- `ctx.invoke` of a command with `dryRun: true` passes `--dry-run` along. Its plan steps are appended to the caller's plan, in the order they happened. `ctx.invoke` of a command without dry-run support fails the caller with exit 1 (the spec 01 rule for a bad invoke) and never runs it. A wrapper that needs a read-only command's answer under `--dry-run` reads it with `ctx.exec(..., { readOnly: true })` or skips the invoke when `ctx.dryRun` is set.

**`ctx.next`.** It takes what an agent would type after the bin (`ctx.next('dotcms wait --instance bench-art --json')`), and Artemis puts `<bin> ` in front, so a tool published under its own name suggests its own name. A command that needs context passed to the next call gives it as a flag or argument, never as an environment variable prefix, so the next call is visible in `help --json`. Lines are collected in order, and duplicates are dropped. They go into the success envelope as `next`. In text mode they are printed to stderr after the result, as "Next: <bin> <line>" lines, and hidden by `--quiet`. On failure they are discarded: the `hint` is the guidance there. A `next` collected by an invoked command is discarded too, because the caller decides what comes next. Anything but a non-empty string is a `TypeError`, and so is a line that starts with the bin followed by a space (`'art dotcms wait'`, which would print the bin twice) or with an environment assignment (`/^[A-Za-z_][A-Za-z0-9_]*=/`, as in `'FOO=1 dotcms wait'`, which would print `art FOO=1 dotcms wait`).

**`ctx.exec` and output.** It spawns `command` with `args` as an array and never through a shell, so nothing in `args` is interpreted. The mode is the first row that applies, top to bottom:

| Mode (first match wins) | Child stdout | Child stderr | Kept for `tail` |
| --- | --- | --- | --- |
| `capture: true` (or `readOnly: true`) | piped into `output`, not echoed | same | yes |
| `--quiet` (any output mode) | piped, not echoed | piped, not echoed | yes |
| `--json` | piped, echoed to **stderr** (stdout stays one object) | piped, echoed to stderr | yes |
| text with `--log` | piped, echoed to stdout | piped, echoed to stderr | yes |
| text, none of the above | inherited (exactly today's `stdio: 'inherit'`, so colors and progress bars keep working) | inherited | no |

`--log` is not a mode. In every piped row it also gets a copy of both streams, captured output included. In inherit mode there is nothing to copy, which only happens without `--log`. In every piped mode stdin is `ignore`. In inherit mode stdin is inherited, as today.

Failures:

- A failed spawn (`ENOENT`) is `CommandError` "<command> was not found", hint "Install it, or check PATH."
- A non-zero exit with `reject` (the default) is `CommandError` "<command> exited with code N". Its `tail` holds the last `EXEC_TAIL_LINES` non-blank lines (no `tail` key in inherit mode, where nothing was kept), and its hint is "Full log: <file>" with `--log`, or "Run again with --log <file> to keep its full output." without. In text mode, when the child's output was not shown (`--quiet` or `capture`), the tail is printed to stderr under the error, so a person sees why the child failed; with `--json` it is only in the envelope.
- With `reject: false`, a non-zero exit returns `{ code, output, skipped: false }` instead of throwing.
- A timeout always throws, `reject: false` included: "<command> took longer than N s", where N is `timeoutMs / 1000` written without trailing zeros (`1.5 s`, `30 s`). The kill is SIGTERM, then SIGKILL after `EXEC_KILL_GRACE_MS`. A timeout carries `tail` and the log hint like any other child failure.
- Every child `ctx.exec` started during a run is tracked. When `run` returns or throws, any still running is killed the same way (SIGTERM, then SIGKILL after the grace period), concurrent ones included, before the envelope is printed.

**`--quiet`.** It hides `ctx.warn`, the "Next:" lines, the every-run version warning, the built-in words' warnings, and every child's output (above). The result, the dry-run plan, under `--json` the envelope, and errors are always printed. `ctx.log` is unaffected in text mode, because it is the command's result for people. A command that prints progress with `ctx.log` should use `ctx.warn` for it, and AGENTS.md says so.

**`--log <file>`.** The path is relative to the current folder. The file is opened (step 5 of the order above) and truncated once per run, and holds, in order: every `ctx.log` and `ctx.warn` line and every child's stdout and stderr, whatever `--quiet` or `--json` hides from the terminal. A `--json --log` run therefore has its `ctx.log` lines in the file, though stdout holds only the envelope. It is closed in `finally`. Its absolute path is in the envelope as `log`. A file that cannot be opened is a `CommandError` before `run` starts, hint "Check the folder exists and can be written.", and that envelope has no `log` key. Like the other global flags, `--log` can come before the command (`art --log b.log dotcms build`). The leading-flag split of spec 01 learns that `--log` takes a value.

**`ctx.invoke` and the output flags.** An invoked command shares the caller's output: it sees the same `ctx.quiet` and `ctx.json`, writes into the same open `--log` file (never reopened, never truncated again), and its children follow the same modes. What it hands back to the caller is spec 01's result. Its `next` is discarded, and its `plan` is appended to the caller's (above).

**Port bases and `maxSlots` in `defineWorktrees`.** Slots run from 0 (the main checkout) to `maxSlots - 1`. Two bases `a` and `b` share a port when `(a - b) % slotStep === 0`: slot N + d of the lower one is slot N of the higher one, with d = |a - b| / slotStep (slot 4 of `elasticsearch`, 9200 + 400 = 9600, is slot 0 of `elasticsearchPerf`). That can only happen when both slots exist, so a pair is refused when d < `maxSlots`. `defineWorktrees` checks this once, when it is called, and throws one `TypeError` that lists every colliding pair, so an app with several mistakes fixes them in one round:

```text
Port bases that share ports across slots (slotStep 100, maxSlots 20):
  elasticsearch (9200) and elasticsearchPerf (9600): slot N + 4 of elasticsearch is slot N of elasticsearchPerf.
Bases a multiple of slotStep apart share ports. Move one base of each pair so the two are not a multiple of 100 apart, or 20 or more slots apart.
```

Two keys with the same base are the same check with d = 0, and the line says "share a port in every slot". Pairs are named in the order the keys were declared. The message suggests no particular port: a suggested one could collide with a third base. The same call refuses, each with a `TypeError` naming the option or key:

- a `slotStep` or `maxSlots` that is not a whole number greater than 0, or a base that is not a whole number;
- a port, in any slot from 0 to `maxSlots - 1`, outside 1024 to 49151 (`MIN_SLOT_PORT`, `MAX_SLOT_PORT`), naming the key, the slot and the port. Below 1024 a port needs root on Linux; from 49152 up the operating system may hand it to an outgoing connection at any time (the dynamic range on macOS and Windows), and 65535 is the last port there is. One range covers all three. Linux's default temporary range (32768 to 60999) overlaps the allowed one and is not checked: it is configurable per machine, and the check is pure.

`ensure` and `ensureDetached` give out the lowest free slot from 1 up, as today (slot 0 is the main checkout and is never given out), and never one at or past `maxSlots`. When every slot from 1 to `maxSlots - 1` is registered, they throw `CommandError` "All 19 slots are taken" (`maxSlots - 1`, the slots that can be given out), hint "Remove an instance you no longer need, or raise maxSlots in defineWorktrees." A registry that already holds a slot past the limit (written before the limit, or under a larger one) is read as it is: `list`, `get` and `current` show it, and nothing renumbers it.

**Ports already in use.** When `ensure` or `ensureDetached` gives out a new slot (never for an instance that is already registered, whose ports are its own and may well be in use by itself), it skips a slot any of whose ports is in use on the machine, and gives out the lowest slot whose ports are all free. The slot is then the instance's for good, as today, so the numbers can have gaps.

- The check is an option, `portsInUse?: (ports: readonly number[]) => ReadonlySet<number>`, like `isCheckout`. Tests pass a fake; `portsInUse: () => new Set()` turns it off. The kit calls it once per candidate slot, lowest first, with that slot's ports, and stops at the first slot whose set comes back empty.
- The default lives in the kit's edge file (`src/kits/worktrees/port-edges.ts`). `ensure` runs inside the registry's `locked()`, which takes synchronous work only (spec 02), so the default cannot use `net` directly. It runs one short child process (`spawnSync(process.execPath, ['-e', PROBE_SCRIPT, ...ports])`, with `timeout` set to what is left of the deadline below) that checks the ports it was given and prints the ones in use. The probe runs while `ensure` holds the registry lock, so all the probes of one `ensure` share a single deadline, `PORT_PROBE_TIMEOUT_MS` (5 s). Each child's `timeout` is what is left of it, and once it is spent every remaining candidate counts as free (fail open, below). The lock is then held for probing at most 5 s, half the store's `LOCK_TIMEOUT_MS` (10 s), so a waiter still gets in however many slots are blocked. Cost: one child per candidate slot, and almost always the first candidate is free, so one child per new instance. Each child makes two listens per port (one per interface), so a six-key app makes 12 listens per child. The worst case, every slot blocked, is `maxSlots - 1` children.
- The probe fails open. A child that times out, exits non-zero, cannot start or prints something unreadable counts as "nothing in use", and the slot is given out as if the check were off. The check is advice (Risks), and an `ensure` that refused to work because a probe broke would cost more than the clash it guards against. The README notes it beside `portsInUse`.
- A port is in use when listening on it fails with `EADDRINUSE` on `0.0.0.0` or on `::`. The probe closes each listener as soon as it is open, as Vite's `isPortAvailable` does, and holds no port longer than its own run. Listening on all interfaces matters: on macOS a listener on `127.0.0.1` can succeed while another program holds `0.0.0.0` on the same port. Any other error (IPv6 turned off) counts as free. A real instance that starts in those few milliseconds and loses the race fails with Docker's bind error, the same race as Risks' "free when probed".
- The two errors are different. When every slot is registered, it is "All N slots are taken" (above). When at least one slot below `maxSlots` is not registered but each such slot has a port in use, it is `CommandError` "No free slot below 20: K of them have ports in use", where K is the count of unregistered slots that were blocked, hint "Slot 1: postgres (5532) is in use. Stop what uses it, or move that base." The hint names the lowest blocked slot and every key of it whose port is in use.
- This is not port scanning: nothing connects to any host. It is the local free-port check every dev server does.

**`label` on the named lock.** `store.lock(name, work, { label })` writes the label into the lock file after the pid and the token: `<pid> <token> <label>`. A label is a non-empty string of one line, at most `LOCK_LABEL_MAX_LENGTH` (120) characters. Spaces are allowed, since the label is everything after the second space. Anything else (an empty string, a newline, too long, not a string) is a `TypeError`. `LockHolder` becomes `{ pid: number | undefined; label?: string }`, so `onWait` gets it, and the error after a timeout reads "<file> is locked by process 80676 (build of core-feat-x).". With no readable pid it reads "<file> is locked by an unknown process (build of core-feat-x).", and without a label the text is spec 02's as it is. The memory store does the same. Document locks keep exactly `<pid> <token>`, which `0.1` reads. A `1.0.0` process reads only the pid from the start of the file and compares whole contents to release or take over, so it shares a labeled named lock safely with a newer one.

The port-base check is pure (`src/kits/worktrees/ports.ts`): it groups the keys by `base % slotStep` in one pass, then checks the pairs inside each group through a helper that lists them, so the check itself has no nested loop.

**AGENTS.md in the package.** `package.json` `files` becomes `["dist", "AGENTS.md"]`. AGENTS.md becomes only the contract for people using Artemis ("Adding a command", "Calling a command", "Running the CLI"). Its section "Working on Artemis itself" moves, word for word, to a new `CONTRIBUTING.md` at the repository root, which is not in `files`. AGENTS.md keeps one closing line in its place: "Working on Artemis itself: read CONTRIBUTING.md in the repository (it is not in the package)." That way an agent in the Artemis checkout still finds the rules, and an agent in an app's repo is told plainly the file is not there. The published AGENTS.md then names no file the package does not ship.

AGENTS.md was the file agents load automatically in this checkout, and the binding rules (read `docs/CODE_STANDARDS.md` first, `pnpm run test:all`, specs drive the work) must not drop to a one-line pointer there. So a repository-root `CLAUDE.md`, not in `files`, holds only imports: `@CONTRIBUTING.md`, and `@AGENTS.md`. Claude Code loads it and the files it imports. This checkout's sessions already load AGENTS.md as project instructions while no CLAUDE.md exists. Whether they keep doing so once one exists is not known, and if they do, `@AGENTS.md` loads it twice (about 3k tokens). The implementer writes both imports, because a missing contract costs more than a duplicate one. The owner then checks a fresh session in this checkout, and if AGENTS.md appears twice, drops `@AGENTS.md` from CLAUDE.md. That check is listed in the Handoff report, not done by the implementer, whose own session was loaded before the file existed. An agent that reads only AGENTS.md (Codex, Gemini CLI) still gets the pointer line, which names CONTRIBUTING.md as the file to read first when working on Artemis.

The README's first lines say "Agents: run `art help --agents` (or read AGENTS.md); it is the short version of this file." The generated skill says "To add a command: `<bin> help --agents`", which works with a global `art` and no local copy, the exact case of the stale-install incident.

## Implementation plan

Branch `spec-03` exists, cut from `main` after spec 02 was merged (`b084a02`). Every step leaves `pnpm run test:all` green.

1. **Spec.** Commit this spec on `spec-03`.
2. **Global flags.** Add `dry-run`, `quiet` and `log` to `GLOBAL_FLAGS`. `defineCommand` rejects them, with the same messages as the other reserved flags. The leading-flag split (`splitLeadingFlags`) takes a value after `--log`. `--dry-run` and `--quiet` are parsed but do nothing yet. The built-in words accept `--quiet` and refuse `--dry-run` and `--log` (exit 2). Tests: each is reserved; `art --log x.log hello`, `art --log=x.log hello` and `art hello --log x.log` parse the same; a repeated `--log` keeps the last; `--log` without a value, and `art --log hello`, are usage errors; `art init --dry-run` and `art state --log x` exit 2.
3. **Manifest fields and `--brief`.** `destructive` and `dryRun` in the definition types, validated as booleans by `defineCommand` (`TypeError` otherwise), and in every full manifest entry (always booleans). `help --json --brief` and `help <topic> --json --brief` per the Data model: nested topics by full id, builtins as `id` and `description`, `help <command> --json --brief` exits 2. Text `help --brief` prints one line per command. Text command help shows "Destructive" and "Supports --dry-run" notes. Tests assert the fields a caller depends on, with no snapshots; that a brief entry has none of the full-only keys.
4. **`destructive` enforcement and the order before `run`.** The order of checks (Behavior), the check before `run` through the spec 02 prompt engine, and `ctx.invoke` passing `--yes` along. Tests, one per path: `--yes`, interactive yes, interactive no, non-interactive without `--yes` (exit 1, both hints when `dryRun` is supported), invoke without `--yes`, a missing argument on a destructive command exits 2 without asking, and `--help` on it asks nothing.
5. **`--dry-run`, `ctx.dryRun`, `ctx.plan`.** The usage error on unsupported commands, `dryRun` and `plan` (`[]` when empty) in the envelope, the text-mode plan list and "Nothing to do.", no confirmation under `--dry-run`, invoke of a dry-runnable command appending its plan to the caller's, and invoke of an unsupported command failing the caller. Fixture commands: one destructive with dry-run, one destructive without. Nothing in this step touches `ctx.exec` (step 8 covers it under `--dry-run`).
6. **`ctx.next`.** Collection, the `<bin> ` prefix (tested with a custom `bin` too), deduplication, the envelope key, kept under `--dry-run`, the stderr "Next:" lines, discarded on failure and inside invoke, and the `TypeError` for a bad value, a line that starts with the bin, and a line that starts with `FOO=1`.
7. **Exec edge.** `src/edges/exec.ts`: `spawn` with `shell: false`, inherit or piped stdio, a line splitter on piped output, kill on timeout (SIGTERM, then SIGKILL after `EXEC_KILL_GRACE_MS`). Tests run real tiny children (`process.execPath` with `-e` scripts): exit codes, interleaved output, ENOENT, timeout, and an argument with spaces and `$(...)` arriving unexpanded.
8. **`ctx.exec`.** `src/context/exec.ts` (pure) picks the mode from `capture`/`readOnly`, `quiet`, `json` and `log` by the table's precedence, and keeps the tail ring (`EXEC_TAIL_LINES`, lines cut at `EXEC_TAIL_LINE_CHARS`). The failure carries `tail` into the envelope, and in text mode prints it under the error when the output was hidden. Under `--dry-run` a call without `readOnly` starts nothing and adds its plan line (with " (in <cwd>)" only when `cwd` was given); a `readOnly` call runs captured. Children still running when `run` ends are killed, concurrent ones included. Tests per row of the table, with fake streams and the real tiny children; one for the precedence (`capture` under `--json --quiet` returns the output); one each for the dry-run plan line with and without `cwd`, `readOnly` running under `--dry-run`, a timeout with `reject: false` still throwing, the "N s" text for 1500 and 30000 ms, and two concurrent children both killed after `run` throws.
9. **`--quiet` and `--log`.** `--quiet` hides `warn`, the "Next:" lines, the built-in words' warnings and child output. `src/edges/log-file.ts` opens the file after the destructive check and before `run`, copies `log`, `warn` and child output into it, and closes it in `finally`. `log` goes into both envelopes, and not into the envelope of a failed open. An invoked command writes into the same open file. Tests: the log holds what `--quiet` hid; a folder that does not exist fails before `run`, with no `log` key; the file is closed after a throw; a `--json --log` run has its `ctx.log` lines in the file; a `--dry-run --quiet` run in text mode still prints the plan; a destructive run declined at the prompt leaves an existing log file unchanged; an invoke does not truncate the caller's log.
10. **Version checks (pure).** `src/utils/semver.ts`: parse (with `v` and `=` stripped), compare, and test each supported range form, with "not checked" for the rest. Tests one case each, including `||`, `1.x`, the partials `1`, `1.2`, `^1` and `~1.2`, `^0.1.2` refusing `0.2.0`, `^0.0.3` refusing `0.0.4`, a range with a prerelease, a running prerelease, a hyphen range, `^1 || ^2` with spaces, `1.X`, `^0` and `^0.0`, `>=1` (not checked), `>=1.2.3 <2` (not checked), and `workspace:*`.
11. **Every-run warning.** `src/cli/version-warning.ts` on the shipped route: `range` and `installed`, exactly one stderr line naming `art doctor` (both facts in it when both warn), hidden by `--quiet`, never in the envelope, never on `art doctor`. `installed` resolves the copy the way Node does from the project root. Tests with temp projects: a range not satisfied, a different local copy, a copy hoisted to a parent `node_modules`, no copy at all (no line), a local copy equal to the running one (no line), a project that does not depend on Artemis (no line), both warnings at once (one line), and `--json` with a mismatch (stdout is still exactly one object).
12. **`art doctor`.** `src/cli/doctor.ts` (pure, every check from what the edges read) and `doctor-command.ts`, wired in `launch.ts` beside `init` and `state`, on the shipped route only, with its `--help` in `word-help.ts`, its entry in `builtins`, and the unknown-command suggestions. With no project: `version`, `project` (`fail`) and `installed` only. The `words` check warns for each project command or topic hidden by `init`, `state`, `skill` or `doctor`. A failing doctor's envelope carries `checks`, with "1 check failed" or "N checks failed". Tests per check and status, the no-project set, the singular and plural error, `checks` present on failure, and the exit code with and without a failure.
13. **`art skill` and `help --agents`.** `src/cli/skill.ts` (pure: manifest plus the project's `package.json` in, markdown out) and `skill-command.ts` (`--write` creating parent folders, never overwriting without the question or `--yes`, "Not written" on a declined question, `--json`, the shadow warning), shipped route only, with its `--help`, `builtins` entry and suggestions like `doctor`. `help --agents` reads the running copy's AGENTS.md (an edge read; the path from the running module's location). Tests: the frontmatter, including a package description with `:`, quotes and a newline (it still parses as YAML) and a package with no `name` or `description`; the destructive section present and absent; examples in manifest order, prefixed with the bin, nothing appended, capped at `SKILL_MAX_EXAMPLES`; no usage lines or flags anywhere; the `help --agents` line; `--write` into a folder that does not exist; an existing file left alone without `--yes` when not interactive; `help --agents` in text and `--json`, with `--quiet` (same output), and exit 2 with a command after it or with `--brief`.
14. **Worktrees port bases and `maxSlots`.** `maxSlots` in `WorktreesOptions` and `KitConfig`, `DEFAULT_MAX_SLOTS` in the kit's `constants.ts`, `src/kits/worktrees/ports.ts` (pure: the bases, the step and the limit in, the problems out), the check in `configure` (`worktrees.ts`), and the limit in `nextFreeSlot`. Tests, one case each: bases 9200 and 9600 with step 100 throw, naming both keys and the distance of 4 slots; 9200 and 9650 pass; a custom `slotStep` is used (9200 and 9600 pass with step 300 and throw with step 200, at a distance of 2); two equal bases throw; three mistakes in one set are all listed in one error; 9200 and 4200 pass with the default `maxSlots` and throw with `maxSlots: 51` (distance 50); a port below 1024 in slot 0 throws, and one past 49151 in the top slot throws, naming the key, slot and port; a `slotStep` or `maxSlots` of 0, a negative one and a fraction are each a `TypeError`; `ensure` with every slot from 1 to `maxSlots - 1` registered throws "All 19 slots are taken" (and never gives out slot 0); a registry holding a slot past the limit still lists it; the scripts repo's base set (8080, 8443, 5432, 9200, 9650, 4200) passes with the defaults.
15. **Ports in use.** `portsInUse` in `WorktreesOptions` and `KitConfig`, the probe edge in `src/kits/worktrees/port-edges.ts`, and slot choice in `nextFreeSlot` (pure: the registry, the ports of each candidate slot and the set in use in, a slot or the reason out). Tests with a fake `portsInUse`: a new instance skips a slot with a port in use and takes the next; `portsInUse` is called lowest slot first and not again after a free one; a registered instance is never checked; every unregistered slot blocked gives the "No free slot … K of them have ports in use" error naming the lowest blocked slot's keys, distinct from "All … slots are taken"; `() => new Set()` gives the lowest free slot as today. Edge tests in a real process: a port held by a server on `0.0.0.0` is reported in use; a free one is not; the probe leaves nothing listening; a probe that cannot run (a bad `execPath` through the edge's injectable spawn, or the timeout) counts as nothing in use; with a fake clock, the probes of one `ensure` stop at the shared deadline and the rest count as free.
16. **Lock label.** `label` in `NamedLockOptions`, written after the token for named locks only, read back into `LockHolder.label`, in `onWait` and the locked error, disk and memory. Tests: the label reaches `onWait` and the error; a label with spaces round-trips; an empty label, one with a newline, one over the limit and a non-string are each a `TypeError`; the error with no readable pid says "an unknown process"; a document lock is still exactly `<pid> <token>`; a lock file written with a label is honored by the spec 02 reader (pid parsed, release and takeover by whole content). `scripts/check-lock.mjs` gains a race on a labeled named lock between real processes, and asserts the waiter sees the label.
17. **Docs.** README: a section "For agents" (`--brief`, then one command; `destructive`, `--yes` and `--dry-run`; `next`; `--quiet` and `--log`; `art skill`; `art doctor`), `ctx.exec`, `ctx.next`, `ctx.plan` and `ctx.dryRun` in the ctx table, the new global flags, and the new definition fields. AGENTS.md: "Calling a command" gains `--brief`, `next`, `plan`, `log` and `tail`, the destructive rule, and the three global flags, and "Adding a command" gains `destructive`, `dryRun`, `ctx.exec` (prefer it to `spawn`), `ctx.next` and `ctx.plan`. AGENTS.md, CONTRIBUTING.md, CLAUDE.md and README per "AGENTS.md in the package" (Behavior). AGENTS.md's "Running the CLI" adds `skill` and `doctor` wherever it lists `init` and `state` as reserved words of the shipped `art`, and the README's "Built-in" list does the same. AGENTS.md says progress belongs in `ctx.warn`, not `ctx.log`, so `--quiet` hides it. The README notes that plan lines, `tail` and `--log` hold arguments and child output as is, and that the port probe fails open. `label` goes in the store kit's named-lock section. README, worktrees section: `maxSlots` and `portsInUse` rows in the options table, and one line under `ports` saying bases must not be a multiple of `slotStep` apart within `maxSlots` slots, or two slots share a port, and that `defineWorktrees` refuses them.
18. **Checks and version.** `scripts/check-bin.mjs`:
    - `help --json --brief` in a temp project;
    - a destructive command run with `--json` and no `--yes` (exit 1 with the hint);
    - `--dry-run --json` (a `plan`, nothing changed on disk);
    - a command using `ctx.exec` on a child that prints 2,000 lines, with `--json --quiet` (stderr empty, the envelope still one object) and with `--log` (the file has 2,000 lines and the envelope names it);
    - `art skill`, whose output names `art help --agents`;
    - `art help --agents` from a temp project with no local copy prints the packed AGENTS.md, and that file names no `docs/`, `specs/`, `CODE_STANDARDS` or `pnpm run` script; the one file it names that does not ship is `CONTRIBUTING.md`, on the line that says it is not in the package;
    - `pnpm pack --dry-run` lists `dist/`, README, LICENSE, `package.json` and AGENTS.md, and nothing else (no CONTRIBUTING.md or CLAUDE.md);
    - `art doctor` with a project that installs a different copy than the global one (an `installed` warning, and no every-run warning line on top).

    Set `package.json` `version` to `2.0.0` (see the "Version" decision). Tagging and publishing stay with the owner.
19. **Review and PR.** Run `/review-standards`, fix the findings, push `spec-03`, open one PR to `main`.

## Acceptance criteria

- [ ] `pnpm run test:all`, `build`, `check-exports`, `check-bin` and `check-lock` pass locally, and in CI on Node 22 and 24.
- [ ] `/review-standards` reports nothing open.
- [ ] `defineCommand` throws a `TypeError` for a command declaring `dry-run`, `quiet` or `log`, and for a `destructive` or `dryRun` that is not a boolean.
- [ ] `--log file`, `--log=file`, before or after the command, parse the same; a repeated `--log` keeps the last; `art --log hello` exits 2. The built-in words accept `--quiet` and exit 2 on `--dry-run` and `--log`.
- [ ] The checks before `run` follow the stated order: a usage error or `--help` on a destructive command asks nothing, and a declined destructive run leaves an existing `--log` file unchanged.
- [ ] Every full manifest entry has `destructive` and `dryRun` as booleans, and every key spec 01 defined keeps its name and position.
- [ ] `help --json --brief` and `help <topic> --json --brief` return entries with only `id`, `description` and, when true, `destructive` and `dryRun`, plus `more`; `topics` lists nested topics by full id; `builtins` entries have only `id` and `description`. No entry has `usage`, `args`, `flags`, `examples` or `aliases`. `--brief` outside `help`, and `help <command> --json --brief`, exit 2.
- [ ] `art help --agents` prints the running copy's AGENTS.md (text, and `{ file, markdown }` under `--json`) with a global `art` and no local copy, on the shipped route and on a published tool's CLI; it accepts `--quiet` and exits 2 with `--brief` or a topic or command.
- [ ] A destructive command run without `--yes` and without a terminal (or under `--json`) exits 1 before `run` is called, with the hint "Pass --yes to confirm." (and the `--dry-run` hint when supported). With `--yes` it runs. In a terminal it asks, and "no" exits 1 with "Cancelled.".
- [ ] `--dry-run` on a command without `dryRun: true` exits 2 and `run` is never called. On one with it, nothing is asked, `ctx.exec` without `readOnly` starts no process and adds its plan line, `ctx.exec` with `readOnly` runs captured, and the envelope has `dryRun: true` and the `plan` (`[]` when nothing was planned). An invoked dry-runnable command's plan is appended to the caller's.
- [ ] `ctx.invoke` of a destructive command without the caller's `--yes` asks again or fails the caller, and passes `--yes` and `--dry-run` when the caller has them.
- [ ] Under `--dry-run --quiet` in text mode the plan still prints. `ctx.next` refuses a line starting with the bin or with an environment assignment (`FOO=1 …`).
- [ ] `ctx.next('dotcms wait --json')` appears as `<bin> dotcms wait --json` (with the project's or tool's bin), once each, in order, as `next` in the success envelope (under `--dry-run` too), as "Next:" lines on stderr in text mode, and nowhere on failure or from inside an invoke.
- [ ] Envelope keys appear in the order `ok`, `command`, `result`/`error`, `hint`, `dryRun`, `plan`, `next`, `log`, `tail`, `checks`, each only under its stated condition.
- [ ] `ctx.exec` never uses a shell: an argument `"$(touch x) a b"` reaches the child as one unchanged string, and no file `x` appears.
- [ ] `ctx.exec` follows each row of the output table (one test per row) and its precedence (first match wins). In text mode without `--quiet`, `--log` or `capture`, the child inherits the terminal, as `stdio: 'inherit'` does today.
- [ ] A child that exits non-zero fails the command with exit 1, `error` naming the command and code, and `tail` holding at most `EXEC_TAIL_LINES` lines of at most `EXEC_TAIL_LINE_CHARS` characters; in text mode with hidden output the tail is printed under the error. A missing executable is "<command> was not found". A timeout kills the child and fails, `reject: false` included. Children still running when `run` ends are killed.
- [ ] With `--json --quiet`, a command whose child prints 2,000 lines writes nothing to stderr and exactly one object to stdout.
- [ ] With `--log <file>`, the file holds every `ctx.log` and `ctx.warn` line and all child output (even under `--quiet` or `--json`), its absolute path is `log` in the envelope on success and failure, an invoke does not truncate it, and a path whose folder does not exist fails before `run` with no `log` key.
- [ ] `semver.ts` decides exact (with `v`/`=`), `^` (0.x pinning included), `~`, `>=`, `>`, `<=`, `<`, `*`, `x`/`X`-ranges, partials (`^0` and `^0.0` included) and `||` with or without spaces as npm does, and returns "not checked" for `workspace:`, `file:`, `link:`, git URLs, tags, space-joined and hyphen ranges, an operator with a partial (`>=1`), ranges with a prerelease, and a running prerelease.
- [ ] On the shipped route, a project whose range does not accept the running version, or whose installed copy (found as Node resolves it, hoisted included) differs from it, gets exactly one stderr line naming `art doctor`, also when both warn. Under `--quiet` and on `art doctor` there is none, and the JSON envelope never contains it.
- [ ] `art doctor` reports every check of the table with a project, and `version`, `project` (`fail`) and `installed` without one, each with `ok`, `warn` or `fail` and a `fix` for each non-ok. It exits 0 with warnings only and 1 with a failure; the failing envelope has "1 check failed" or "N checks failed", the first fix as `hint`, and every check in `checks`. It is on the shipped route only.
- [ ] `art skill` prints the fixed template filled from the manifest: frontmatter with `name` and a double-quoted `description` that stays valid YAML for any package description, the `help --agents` line, the destructive section only when a command is destructive, at most `SKILL_MAX_EXAMPLES` examples in manifest order prefixed by the bin, and no usage lines, args or flags. `--write` creates missing folders and never overwrites without the question or `--yes`. It is on the shipped route only.
- [ ] `builtins` in `help --json` lists `init`, `state`, `skill` and `doctor` on the shipped route, `art skill --help` and `art doctor --help` work like `art state --help`, and a project command named `skill` or `doctor` is hidden there with a warning from the word and in `art doctor`'s `words` check.
- [ ] `defineWorktrees` throws one `TypeError` listing every pair of port bases a multiple of `slotStep` apart and fewer than `maxSlots` slots apart, with both keys and the slot distance (9200 and 9600 at step 100: distance 4), and accepts 9200 and 9650. It uses a custom `slotStep` (step 300 passes, step 200 throws at distance 2) and a custom `maxSlots` (9200 and 4200 pass at the default 20 and throw at 51). It refuses a `slotStep` or `maxSlots` that is not a whole number greater than 0, and any slot port outside 1024 to 49151. `ensure` never gives out slot 0 or a slot at or past `maxSlots`. The scripts repo's base set (8080, 8443, 5432, 9200, 9650, 4200) passes with the defaults. The error text says "slot N + d of <lower> is slot N of <higher>".
- [ ] All port probes of one `ensure` share one `PORT_PROBE_TIMEOUT_MS` deadline, below the store's `LOCK_TIMEOUT_MS`.
- [ ] A new instance skips a slot with a port in use (on `0.0.0.0` or `::`) and takes the next free one; a registered instance is never checked; with every unregistered slot blocked the "No free slot" error names the lowest blocked slot's ports in use, and it differs from "All N slots are taken"; `portsInUse: () => new Set()` turns the check off. The default probe leaves nothing listening, and a probe that fails or times out counts as nothing in use.
- [ ] `store.lock(name, work, { label })` shows the label to `onWait` and in the locked error, on disk and in memory, with "an unknown process" when no pid is readable. An empty, multi-line, too long or non-string label is a `TypeError`. Document locks stay `<pid> <token>`, the spec 02 lock reader honors a labeled named lock, and `check-lock` races a labeled lock between real processes.
- [ ] The packed package contains AGENTS.md and neither CONTRIBUTING.md nor CLAUDE.md; the repository's `CLAUDE.md` imports `@CONTRIBUTING.md` and `@AGENTS.md`; the packed AGENTS.md names no file the package does not ship except CONTRIBUTING.md, which it says is not in the package; the README's first lines point agents to `art help --agents`, and `art skill` output names it.
- [ ] `package.json` `version` is `2.0.0`, and no tag was created.
- [ ] README, AGENTS.md, CONTRIBUTING.md and CLAUDE.md document everything above, and AGENTS.md tells agents to read `--brief` first.

## Decisions

- **Yes (owner, 2026-11-11):** one spec for all of it (the owner: "this is agent optimization"). Every item serves the same goal, the tokens an agent spends around a command: reading before the call (discovery, the skill, the shipped AGENTS.md, the doctor) or tracing a failure after it (exec tails, port bases, the lock label). They ship in one release, `2.0.0`. The cost is a long spec and a long PR. Each step stays independently green to keep it reviewable.
- **Yes:** `--brief` as a flag of `help` only, not global. It means nothing to any other command, and reserving one more name would cost commands a flag.
- **No:** a new single-command level. It exists (`help <command> --json`, `<command> --help --json`). The brief manifest's `more` key and the skill tell agents to use it.
- **Yes (owner, 2026-11-11):** `destructive` asks in a terminal and needs `--yes` otherwise. It is the same contract as every prompt, so agents already know the fix, and commands drop their hand-written confirms.
- **No:** always requiring `--yes`, even in a terminal. A person at a terminal can answer, and refusing them is friction with no safety gain.
- **No:** `destructive` as a manifest marker only. Unenforced, it is prose in another format.
- **Yes (owner, 2026-11-11):** `--dry-run` is opt-in per command, and a usage error elsewhere. The framework cannot know what an arbitrary command would do, and silently running a command that ignores `--dry-run` would be the worst possible failure.
- **Yes:** under `--dry-run`, `ctx.exec` records instead of running. Most of what a command does to the world goes through child processes, so the plan fills itself. A call whose output the command needs, and which changes nothing, passes `readOnly: true` and runs for real; anything else checks `ctx.dryRun`.
- **Yes (owner, 2026-11-11):** `next` in the envelope, set through `ctx.next`. The result stays the command's own data, and every command gets the key in the same place.
- **Yes (owner, 2026-11-11):** `ctx.exec` plus `--quiet` and `--log`. Child output is the bulk of the flood, and it bypasses Artemis today, so flags alone could not reach it.
- **Yes:** inherit mode stays the default in a terminal. Piping would break children's colors and progress bars for people. Artemis pipes only when something needs the bytes (`--json`, `--quiet`, `--log`, `capture`, `readOnly`).
- **Yes:** under `--json`, child stdout is echoed to stderr. Stdout must stay exactly one object, which is the core promise of spec 01.
- **Yes:** `--quiet` also hides `ctx.warn`. For an agent, the progress lines of the scripts repo (`ctx.warn('Starting Docker...')`) are the flood; errors and the result still come through, and `--log` keeps everything.
- **Yes:** no shell in `ctx.exec`. An argument array cannot be injected, and commands built by agents are exactly where untrusted strings end up in arguments.
- **Yes:** the failure envelope carries `tail`. The last lines of a failed build are usually all an agent needs, and a capped tail costs a fixed, small amount.
- **Yes (owner, 2026-11-11):** `art skill` is a built-in word that generates the skill. Generated from the manifest, it cannot drift, and a fixed template keeps it to about 30 lines.
- **No:** a `guide` field inside `help --json`. Agents load skills before they run anything, so a file is where the guidance gets read.
- **Yes (owner, 2026-11-11):** a version warning on every run plus `art doctor`. The warning catches the incident that happened (a stale `art` running silently), and the doctor explains it and checks the rest.
- **Yes:** the warning goes to stderr and never into the envelope, and `--quiet` hides it. The envelope's shape stays the command's; an agent that wants the details runs `art doctor --json`.
- **Yes:** our own small range checker, not the `semver` package. Spec 02 brought the runtime dependencies down to one with none of its own, and a warning only needs the common forms. Anything else is "not checked", never a false alarm.
- **Yes:** `skill` and `doctor` are reserved on the shipped route only, like `init` and `state` (spec 02). A published tool's command names stay its own.
- **Yes:** Version `2.0.0`. The rule drafted on 2026-11-11 was "`1.0.0` if it merges before `1.0.0` is tagged, `2.0.0` otherwise", and `v1.0.0` is tagged, so it is `2.0.0`. This spec breaks semver in three separate ways, each enough on its own: reserving the flags `dry-run`, `quiet` and `log` breaks any command that declares one; reserving the words `skill` and `doctor` on the shipped `art` hides any project command or topic with those names; and the worktrees kit now refuses things it used to accept: port bases that meet within `maxSlots` slots or leave 1024 to 49151 there, even when the app never runs the slot where they would clash, and any slot at or past `maxSlots`. No known command or app is affected (the scripts repo was checked on 2026-11-11). The implementer sets `package.json` `version` to `2.0.0` in step 18. The owner tags and publishes, as the Handoff says.
- **Yes (owner, 2026-11-11):** the worktrees port-base check belongs in this spec. An agent found it: the mistake cost a failed run and a trace through Docker, which is the kind of token loss this spec is about.
- **Yes (owner, 2026-11-11):** a slot limit, `maxSlots`, default 20 (the default chosen in drafting). Without one, any two bases a multiple of the step apart would be refused at any distance, including the scripts repo's 9200 and 4200 (50 slots apart), which can only meet if 51 instances exist. With one, the check refuses exactly the pairs that can meet, and `ensure` keeps the promise by never going past it.
- **No:** refusing every pair at any distance. Always safe, but it refuses sets that cannot collide in practice and makes apps move ports for a 51st instance nobody runs.
- **No:** refusing near pairs and only warning for far ones. A threshold with no slot limit behind it still lets the far pair collide.
- **Yes:** check the bases once, when `defineWorktrees` is called. It is pure arithmetic, it runs before any instance exists, and it names the keys, where the failure it prevents names a container port.
- **Yes:** list every colliding pair in one error, not only the first. An agent fixes them all in one round instead of one per run.
- **No:** suggesting a port in the message ("e.g. 9650"). A suggested port can collide with a third base; the rule (not a multiple of the step apart) is always right.
- **Yes (owner, 2026-11-11):** check ports in use when a new slot is given out, and skip a taken slot (the skip chosen in drafting). It is the only check that sees other software, like a local Postgres on 5432. Skipping, as Vite does with its next port, gives a working instance instead of an error; the slot is stable once given, so a gap costs nothing.
- **Yes:** probe in a child process with `spawnSync`. `ensure` runs under the registry's synchronous lock, and making `ensure` asynchronous would break every app that calls it. One short child per candidate slot, lowest first, stopping at the first free one: usually one child per new instance, at most `maxSlots - 1`, all within one `PORT_PROBE_TIMEOUT_MS` deadline, and never for a registered instance or a plain run.
- **Yes:** probe on `0.0.0.0` and `::`, as Vite does. A probe on `127.0.0.1` alone can succeed on macOS while another program holds the port on all interfaces.
- **Yes:** one allowed range for every slot port, 1024 to 49151. It covers root-only ports, the dynamic range of macOS and Windows, and the top of the port space in one rule. Linux's configurable temporary range is not checked: the check would depend on the machine.
- **No:** probing the main checkout's ports (slot 0). Slot 0 is never given out, so there is no moment to choose another; a clash there is the app's configuration, and the error from Docker names it.
- **Yes (owner, 2026-11-11):** `label` on named locks only. Document locks keep the format `0.1` reads; named locks are new in spec 02, and the spec 02 reader already ignores what follows the pid.
- **Yes (owner, 2026-11-11):** ship AGENTS.md in the package, and point the README and the generated skill to it. It is the agent-sized version of the README already; shipping it is cheaper than writing and maintaining a second summary.
- **Yes (owner, 2026-11-12):** move "Working on Artemis itself" out of AGENTS.md into `CONTRIBUTING.md`, which does not ship. Shipped whole, AGENTS.md sent an agent in an app's repo to `docs/CODE_STANDARDS.md`, `specs/` and `pnpm run test:all`, none of which the package has. Moving the section keeps one file shipped as is, with no build step and no second copy to keep in step. One line stays in AGENTS.md pointing to CONTRIBUTING.md and saying it is not in the package, so agents in the Artemis checkout still find the rules.
- **Yes:** a repository `CLAUDE.md` that imports CONTRIBUTING.md and AGENTS.md, not shipped. Moving the section out of the auto-loaded file would otherwise leave the binding rules in a file nobody loads; a past review here skipped the spec for exactly that reason (no CLAUDE.md). Import lines cannot drift from the files they load. `@AGENTS.md` may load AGENTS.md twice if sessions also load it directly; the owner checks a fresh session after the change and drops that import if so (Behavior).
- **No:** keeping the section with a "not in the package" note. Every app agent would still pay to read rules that do not apply to it.
- **No:** trimming AGENTS.md at pack time. A generated second copy is the "second file to keep in step" the shipping decision avoided.
- **Yes (owner, 2026-11-12):** `art help --agents` prints the running copy's AGENTS.md, and the skill points to it. `node_modules/@zjaaal/artemis/AGENTS.md` does not exist with a global `art` and no local copy, which is the stale-install incident this spec starts from. The running copy always has its own file. It is a flag of `help`, not a new word, so nothing more is reserved, and it works on a published tool's CLI too.
- **No:** a path in the skill (relative or resolved when generating). Relative fails for global installs, and an absolute path is machine-specific in a file people commit.
- **No (owner, 2026-11-11):** `state` (and `skill`, `doctor`) on a published tool's own CLI, asked for again on 2026-11-11 (the owner: "if it's by design let's keep it"). Spec 02's reason stands: a tool's command names stay its own. The scripts repo keeps `npx artemis state`.
- **Yes:** the port-base and port-range checks are breaking changes, and the version decision counts them. A pair of bases d slots apart fails today only when slots N and N + d run together, so an app that never runs more than d instances works now and is refused after this. The range check likewise refuses a set that only leaves the range in a slot the app never reaches (a base of 49000 with step 100 passes 49151 from slot 2). Refusing them is still right: the failure is a matter of when, it arrives as a Docker bind error, and the fix is one number. The slot limit breaks too: an app that runs more than 19 extra instances at once must raise `maxSlots`. No known app hits any of the three (the scripts repo uses a handful of instances, and its bases pass).
- **Yes (owner, 2026-11-12):** `ctx.next` takes what follows the bin, and Artemis adds the bin. A command written for `art` and shipped as `mytool` suggests `mytool`. The scripts repo's `ART_INSTANCE=… art dotcms wait` becomes `dotcms wait --instance …`: context passed as a flag shows in `help --json`, where an environment variable is invisible.
- **No:** exposing `ctx.bin` for commands to build full lines. Every author has to remember it, and forgetting it is exactly the bug.
- **Yes (owner, 2026-11-12):** `readOnly: true` on `ctx.exec` runs the call even under `--dry-run`, captured. A dry run often has to read state (`git rev-parse`, `docker ps`) to say what it would do, and without this every such read is hand-rolled around `ctx.dryRun`. The author vouches for each call, one at a time, where it is made.
- **No:** a `readOnly` marker on command definitions that lets `ctx.invoke` run them under `--dry-run`. It is a third manifest marker to enforce, for a case `ctx.exec(..., { readOnly: true })` or a `ctx.dryRun` check already covers. It can come later on its own.
- **Yes:** a failing `art doctor` puts its checks in a `checks` key of the failure envelope. Spec 01's failure envelope has no `result`, and an agent should get every fix in one call, not just the first. It follows the pattern of `tail`: a failure key that exists only where it applies.
- **No:** a doctor that always reports `ok: true` with failing checks inside. It would break the rule that `ok` matches the exit code.
- **Yes:** the order before `run` is parse, `--help`, the `--dry-run` support check, the destructive check, the `--log` open, then `run`. Usage errors come first so a wrong command line never asks a question. The log opens after the confirmation, so a declined run never truncates a log the user kept.
- **Yes:** the `ctx.exec` table has a precedence (`capture`/`readOnly`, `--quiet`, `--json`, `--log`, inherit), and `--log` is a copy in every piped mode, not a mode of its own. The rows overlapped as first drafted.
- **Yes:** in text mode, a failed child whose output was hidden prints its tail under the error. Otherwise a person who used `--quiet` sees only "mvn exited with code 1".
- **Yes:** the port probe fails open. It is advice. A broken probe that stopped `ensure` would cost more than the clash it looks for, and Docker still names the port if a clash gets through.
- **Yes:** the probe asks one slot at a time, lowest first, and stops at the first free one, so a normal `ensure` starts one child. The drafted "one child covering every slot" did up to 19 × keys × 2 listens to answer a question that is almost always settled by the first slot.
- **Yes:** built-in words take `--quiet` and refuse `--dry-run` and `--log` (exit 2). `--quiet` only hides warnings, which every word has. None of them runs `ctx.exec` or has a plan, and spec 02 already refuses flags a word does not take.
- **No:** marking `state` or `skill` as `destructive`. Only `state --reset` and `skill --write` over an existing file change data, and they already ask on their own (spec 02's reset rule). Marking the whole word would tell an agent that listing state needs `--yes`.
- **Yes:** `help <command> --json --brief` is a usage error. One entry is already the small level, and a brief entry would hide the args the agent came for.
- **No:** a byte budget for `--brief`. On the 11-command fixture tree the brief form is about 29% of the full one (796 of 2,740 bytes, measured 2026-11-12), so a ratio there measures the fixture, not the feature, and moves whenever a fixture command is added. The saving comes from which keys a brief entry may have, and the tests pin those. The Handoff report records both sizes.
- **Yes:** semver follows npm's meaning for the forms it understands, including caret pinning on 0.x and partial versions. The incident was a 0.1.x install, so `^0.1.2` has to refuse `0.2.0`. A running prerelease is not checked against ranges, but `installed` still compares exact versions.
- **Yes:** the every-run warning is one line, naming both facts when `range` and `installed` both warn, and it never prints on `art doctor`, which reports the same facts as checks.

## Risks

| Risk | Mitigation |
| --- | --- |
| Piped children lose colors and progress bars | Only when output is piped: `--json`, `--quiet` and `capture`, where nobody reads the child's output in a terminal, and text mode with `--log`, where a person may be watching and loses the child's colors for the run. The README says so beside `--log`. Text mode without those flags keeps inherit. |
| A child keeps running after Artemis fails or is interrupted | Every child is tracked and killed when `run` ends; a timeout sends SIGTERM, then SIGKILL after `EXEC_KILL_GRACE_MS`. Ctrl+C reaches inherited and piped children through the terminal's process group, as today. A SIGTERM sent to Artemis alone (not its group) is not forwarded: the children outlive it. Forwarding signals is out of scope; the README says to signal the process group. |
| Plan lines, `tail` and `--log` show a secret passed as an argument or printed by a child | They hold what was passed or printed, as is: what the child printed is what a terminal would have shown, and `tail` is capped. The README says so; commands should pass secrets through `env`, which is never shown. |
| A `readOnly` exec that is not read-only changes something under `--dry-run` | The author vouches for it, call by call; AGENTS.md says to mark only calls that change nothing. Artemis cannot check it. |
| The port probe breaks on some machine and every slot looks free | Fails open by design: the check is advice, and Docker still names the port in a real clash. |
| A command needs a child's real output under `--dry-run` | A read-only call passes `readOnly: true` and runs captured. Any other call returns `skipped: true` and empty output, and the command checks `ctx.dryRun`. The README says so beside `capture` and `readOnly`. |
| The version warning is noise in monorepos (`workspace:*`, `link:`) | Those forms are "not checked", never warned. |
| An agent ignores `next` and guesses anyway | The skill and AGENTS.md say to follow it; it is additive and costs nothing when ignored. |
| A destructive confirmation inside `ctx.invoke` surprises a caller that was already confirmed | Stated rule: a confirmation covers the named command only. The caller passes `--yes` along when the user gave it. |
| Reserving three flag names and two words breaks an unknown user's command | The `TypeError` names the flag; `art doctor`'s `words` check and the word's own warning name a hidden command. It ships as `2.0.0` (Decisions). |
| The every-run warning reads `node_modules` on each start | One small `package.json` read on the shipped route only, alongside the one already read to find the project. |
| A port is free when probed and taken before the instance starts | The probe is advice, not a reservation: it catches the lasting clash (a local service), not a race. Docker's error still names the port in the rare race. |
| Listening on all interfaces makes the macOS application firewall ask "Allow incoming connections?" | Only when that firewall is on and the Node binary is not signed (Node from nodejs.org is). It can happen when a new slot is probed, never on a plain run. Documented beside `portsInUse`, which can turn the probe off. |
| The probe child adds time to `ensure` | One short `node -e` per candidate slot (tens of milliseconds each), usually one per new instance; all probes of one `ensure` share a 5 s deadline. Never for a registered instance or a plain run. |

## Handoff

- **Runs in:** the artemis checkout via `/spec-impl 03 delegated`, on the existing `spec-03` branch (spec 02 is merged into `main`).
- **Reads first:** `docs/CODE_STANDARDS.md`, specs 01 and 02 (the envelope, the built-in words, the prompt engine), and this spec's "Why this spec exists".
- **May:** work on `spec-03`; commit each step; set `package.json` `version` to `2.0.0`; push `spec-03`; open one PR to `main`.
- **Must not:** merge; create a tag, a release or a GitHub release; publish; touch the scripts repo; add a dependency (none is needed); change specs 01 or 02.
- **Node versions:** the checks run on the machine's Node; CI proves 22 and 24. The report states the local version.
- **Stops and reports when:** a step needs a decision this spec doesn't make; the working tree has changes other than `specs/03-agent-economy.spec.md` at the start (that one is expected, and step 1 commits it); a check fails twice.
- **Reports:** steps done, PR link, commands run with results, the measured sizes of `help --json` and `help --json --brief` on the fixture tree, open questions, bugs found by tests, and a reminder for the owner to check in a fresh session whether AGENTS.md now loads twice (CLAUDE.md, Behavior).

## What is **not** in this spec

- Kits that ship commands (its own spec).
- The store kit (spec 02).
- `state`, `skill` and `doctor` on a published tool's own CLI (kept out on purpose; see Decisions).
- Static `next` in definitions, structured progress events, a full semver parser.
- A `readOnly` marker on command definitions, and forwarding signals to children.
- Moving the scripts repo onto `destructive`, `ctx.exec` and `ctx.next` (its own spec in that repo).

Each one, if it lands, goes in its own spec.
