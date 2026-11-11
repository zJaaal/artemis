# SPEC 03 — Agent economy: cheaper discovery, safety as data, next steps, quiet runs, a generated skill and a doctor

> **Status:** Draft
> **Depends on:** SPEC 02
> **Date:** 2026-11-11
> **Objective:** Cut the tokens an agent spends to find, call and follow Artemis commands safely, by putting discovery levels, destructive and dry-run markers, next steps, output control, a generated skill and a version doctor into the contract instead of into prose.

## Why this spec exists

Artemis's pitch is that a command saves an agent the tokens of redoing work by hand. A benchmark on the scripts repo ("hard" task: start a dotCMS instance for a worktree and wait for it) showed where that saving leaks. The agent using `art` lost its token advantage to **reading**, not to running:

- **Discovery read too much.** `art dotcms help --json` is 8.8 KB, and the agent needed one command. The single-command level already exists (`art help dotcms start --json` and `art dotcms start --help --json` both return one entry, 392 bytes on the fixture `hello`), but nothing tells an agent to go there, and there is no level between "everything about every command" and "one command".
- **Safety rules are prose.** The scripts repo's `AGENTS.md` lists in sentences which commands destroy data (`dotcms prune`, `dotcms remove`), and each of those commands writes its own `ctx.prompt` confirm. An agent has to read a page to stay safe, and nothing enforces the page.
- **The next step is guessed.** Several of the agent's 16 turns went to working out what to run after `dotcms start` succeeded (`ART_INSTANCE=bench-art art dotcms wait --json`). Errors already carry a `hint`; successes carry nothing.
- **Progress floods the context.** `lib/docker.js` runs Maven and Docker with `spawn(command, args, { stdio: 'inherit' })`, so their output never passes through Artemis. A Maven build or a `pnpm install` is thousands of lines, and an agent reading stderr pays for all of them.
- **The agent doc drifts.** Prose about the CLI is written by hand and goes stale. Everything it needs to say is already in the manifest.
- **A stale install runs silently.** `art` kept running an old `0.1.1` while the project expected newer; nothing warned.

This spec puts each of those into the contract that agents already read (`help --json`, the `--json` envelope, exit codes), so the saving comes back without new prose. The owner chose one spec (2026-11-11): every item is the same goal, agent token economy, and they ship as one release.

## Scope

**In:**

- `help --json --brief` (and `help <topic> --json --brief`): ids and one-line descriptions only.
- `destructive: true` on a command definition: shown in the manifest and enforced. It asks in a terminal and needs `--yes` when nobody can answer.
- `dryRun: true` on a command definition, a global `--dry-run`, `ctx.dryRun` and `ctx.plan(step)`, and `plan` in the envelope. `--dry-run` on a command that does not support it is a usage error.
- `ctx.next(...commands)` and `next` in the success envelope.
- `ctx.exec(command, args, options)`, the global `--quiet` and `--log <file>`, `log` in both envelopes, and `tail` (the last lines of a failed child) in the failure envelope.
- `art skill [--write <path>]`, a built-in word that generates a short `SKILL.md` from the manifest.
- `art doctor`, a built-in word that checks the install and the project and gives a fix for each problem, plus a one-line version warning on every run of the shipped binary.
- README, AGENTS.md, `check-bin`.

**Out of scope (for future specs):**

- Kits that ship commands (`list` and `remove` for the worktrees kit). It changes discovery, so it gets its own spec.
- The store kit, which is spec 02.
- `skill` and `doctor` on a published tool's own CLI (`cli({ root })`). They are reserved on the shipped route only, like `init` and `state`.
- Static next steps declared in a definition (`next: [...]` in `defineCommand`). `ctx.next` is enough until a command needs both.
- A full semver range parser. The version check understands the common forms and says "not checked" for the rest.
- Streaming progress events (structured progress in `--json`). `--quiet` and `--log` cover the token cost.
- Migrating the scripts repo onto `destructive`, `ctx.exec` and `ctx.next` (its own spec in that repo).

## Data model

Types live in `src/models.ts`. Constants live in `src/constants.ts`.

```ts
// CommandDefinition gains two optional fields (both still pass the extra-field rule untouched otherwise):
export type CommandDefinition<TArgs, TFlags> = {
    // ...everything from spec 01
    destructive?: boolean; // changes or deletes data the user cannot get back. Default false
    dryRun?: boolean; // the command honors ctx.dryRun: it reports what it would do and does none of it. Default false
};

// ctx gains:
export type CommandContext = {
    // ...json, interactive, style, log, warn, prompt (spec 02), commands, invoke
    dryRun: boolean; // --dry-run was passed (only ever true for a command with dryRun: true)
    quiet: boolean; // --quiet was passed
    next: NextFn; // suggest what to run after this succeeds
    plan: PlanFn; // under --dry-run: describe one thing the command would do
    exec: ExecFn; // run a child process whose output follows --quiet, --log and --json
};
export type NextFn = (...commands: string[]) => void; // full command lines, as an agent would type them
export type PlanFn = (step: string) => void; // a no-op outside --dry-run

export type ExecFn = (command: string, args?: readonly string[], options?: ExecOptions) => Promise<ExecResult>;
export type ExecOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv; // default: the process environment
    capture?: boolean; // return the output instead of showing it (git rev-parse, docker ps). Default false
    reject?: boolean; // a non-zero exit throws. Default true
    timeoutMs?: number; // kill the child (SIGTERM, then SIGKILL after EXEC_KILL_GRACE_MS) and throw. Default: none
};
export type ExecResult = {
    code: number; // 0 under --dry-run
    output: string; // stdout and stderr interleaved; '' when the output was shown on the terminal (inherit mode)
    skipped: boolean; // true under --dry-run: nothing ran
};
```

Global flags (`GLOBAL_FLAGS`) grow from `help`, `json`, `yes` to:

```ts
'dry-run': { type: 'boolean', description: 'Say what the command would do, and do none of it' },
quiet: { type: 'boolean', description: 'Print only the result or the error: no progress, no warnings, no child output' },
log: { type: 'string', description: 'Write everything the command and its child processes print to this file' },
```

`dry-run`, `quiet` and `log` become reserved: `defineCommand` throws a `TypeError` for a command that declares any of them, as it does for `help`, `json` and `yes`. No short forms are added (`-q` and `-n` stay free for commands). `--brief` is not global. It is a flag of the `help` word only, and anywhere else it stays an unknown flag (exit 2), as today.

The envelope, with new keys added after the existing ones, and only when they have content:

```jsonc
// success
{ "ok": true, "command": "dotcms start", "result": { "instance": "bench-art" },
  "next": ["ART_INSTANCE=bench-art art dotcms wait --json"],   // ctx.next
  "log": "/abs/start.log" }                                    // --log
// success under --dry-run
{ "ok": true, "command": "dotcms prune", "result": { ... }, "dryRun": true,
  "plan": ["docker volume rm dotcms-bench-art_dbdata", "remove data/compose-dotcms-bench-art.yml"] }
// failure of a child run through ctx.exec
{ "ok": false, "command": "dotcms build", "error": "mvn exited with code 1",
  "hint": "Full log: /abs/build.log", "log": "/abs/build.log",
  "tail": ["[ERROR] Failed to execute goal ...", "..."] }      // last EXEC_TAIL_LINES lines, each cut at EXEC_TAIL_LINE_CHARS
```

`next` and `plan` exist only on success. `log` exists on both whenever `--log` was given. `tail` exists only when the failure came from `ctx.exec`. Keys spec 01 defined (`ok`, `command`, `result`, `error`, `hint`) keep their names and order.

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

`art doctor`:

```ts
export type DoctorCheck = {
    id: 'version' | 'range' | 'installed' | 'project' | 'module' | 'commands' | 'state';
    status: 'ok' | 'warn' | 'fail';
    message: string;
    fix?: string; // what to run or change; present on warn and fail
};
// art doctor --json  ->  { ok: true, command: "doctor", result: { version, checks: DoctorCheck[] } }
// exit 0 when no check fails (warnings allowed), exit 1 when one does, and the envelope is then ok: false
// with error "N checks failed" and hint naming the first fix.
```

The checks, in order:

| id | What it checks | warn / fail |
| --- | --- | --- |
| `version` | The version of the Artemis that is running (its own `package.json`) | always `ok`, informational |
| `range` | The project's `dependencies` or `devDependencies` range for `@zjaaal/artemis` against the running version | `warn` when not satisfied; `ok` with "not checked: <range>" for forms the checker does not understand; `ok` when the project does not depend on Artemis |
| `installed` | The project's own copy (`<root>/node_modules/@zjaaal/artemis/package.json`) against the running version | `warn` when they differ: "a global art 0.1.1 is running; this project installs 1.1.0", fix "Run npx art, or update the global art." |
| `project` | A project is found, and which `package.json` it is | `fail` when none |
| `module` | `"type": "module"` in that `package.json` | `warn` |
| `commands` | The commands folder exists and every file loads (discovery errors listed) | `fail` |
| `state` | `stateDir` (spec 02): exists or not (`ok` either way), and every document parses (`inspectDocument`) | `warn` per unreadable document, fix "art state <doc> --reset" |

The every-run warning is `range` and `installed` only. They are cheap: the project's `package.json` is already read, plus one `package.json` from `node_modules`. It runs on the shipped route and prints one line to stderr. It is never part of the JSON envelope, so stdout stays one object. `--quiet` hides it, and it names `art doctor` for details.

Version ranges (`src/utils/semver.ts`, pure): exact `1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`, `>1.2.3`, `<=`, `<`, `*`, `x`-ranges (`1.x`, `1.2.x`), and `||` between any of those. Any other form (`workspace:`, `file:`, `link:`, a git URL, a tag, a space-joined range, a prerelease) is "not checked", never a warning.

`art skill`:

```
art skill [--write <path>] [--yes] [--json] [--help]
```

It prints a `SKILL.md` built from the manifest to stdout, or writes it to `<path>`. It never overwrites a file without asking: in a terminal it asks, and otherwise it needs `--yes` (the reset rule of spec 02). Under `--json` the result is `{ markdown }`, or `{ file }` with `--write`. Its content is fixed and short:

```markdown
---
name: <bin>
description: Use the <bin> CLI of <package name> instead of doing these tasks by hand. <package description>
---

# <bin>

- Find commands: `<bin> help --json --brief`. One command in full: `<bin> help <command> --json`.
- Call with `--json`: one object on stdout. `ok: false` has `error` and often `hint`: do what the hint says.
- Exit codes: 0 ok, 1 the command failed, 2 the command line was wrong.
- Nothing prompts with `--yes` or `--json`. A destructive command needs `--yes`.
- When a result has `next`, those are the commands to run next.
- Long output: add `--quiet`, or `--log <file>` to keep the full output in a file.

## Destructive (need `--yes`; try `--dry-run` first where marked)

- `<bin> dotcms prune`: Delete an instance's data (`--dry-run`)
- ...

## Examples

- `<bin> dotcms start --json`
- ... (the definitions' `examples`, at most SKILL_MAX_EXAMPLES)
```

The destructive section is left out when no command is destructive, and the examples section when none has examples. No usage lines, args or flags: the skill points at `help <command> --json` for those, so it stays short and never goes stale.

Constants (`src/constants.ts`): `EXEC_TAIL_LINES = 40`, `EXEC_TAIL_LINE_CHARS = 500`, `EXEC_KILL_GRACE_MS = 5000`, `SKILL_MAX_EXAMPLES = 10`, `SKILL_WORD = 'skill'`, `DOCTOR_WORD = 'doctor'`, `ARTEMIS_PACKAGE = '@zjaaal/artemis'`.

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
```

## Behavior

**`destructive`.** Before `run` starts, `run()` checks a destructive command:

- under `--dry-run`, nothing is asked, because nothing will be changed;
- with `--yes`, it runs;
- interactive (spec 01's rule: a terminal, and neither `--json` nor `--yes`): it asks through the spec 02 `confirm`, "<bin> <id> changes or deletes data that cannot be recovered. Continue?", default no. Declining is `CommandError` "Cancelled." (exit 1);
- otherwise it fails before `run` with `CommandError` "<bin> <id> changes or deletes data", hint "Pass --yes to confirm." and, when the command supports dry runs, "Pass --dry-run first to see what it would do." (exit 1).

`ctx.invoke` of a destructive command passes the caller's `--yes` and `--dry-run` along, as spec 01 passes `--yes`. Without them, it asks again or fails the caller: a confirmation covers the command the user named, not the ones it calls.

**`--dry-run`.** It is valid only for a command with `dryRun: true`; on any other it is a `UsageError` "<id> does not support --dry-run" (exit 2), so nothing runs by surprise. Under it, `ctx.dryRun` is true. `ctx.plan(step)` collects steps. `ctx.exec` does not start the child: it adds "<command> <args...> (in <cwd>)" to the plan and returns `{ code: 0, output: '', skipped: true }`. The envelope gets `dryRun: true` and `plan`. In text mode the plan is printed as a list after the command's own output. `ctx.invoke` of a command without dry-run support under `--dry-run` fails the caller with exit 1 (the spec 01 rule for a bad invoke), never runs it.

**`ctx.next`.** It collects command lines in order, and duplicates are dropped. They go into the success envelope as `next`. In text mode they are printed to stderr after the result, as "Next: <command>" lines, and hidden by `--quiet`. On failure they are discarded: the `hint` is the guidance there. A `next` collected by an invoked command is discarded too, because the caller decides what comes next. Anything but a non-empty string is a `TypeError`.

**`ctx.exec` and output.** It spawns `command` with `args` as an array and never through a shell, so nothing in `args` is interpreted. How the child's output travels:

| Mode | Child stdout | Child stderr | Kept for `tail` |
| --- | --- | --- | --- |
| text, no `--quiet`, no `--log`, no `capture` | inherited (exactly today's `stdio: 'inherit'`, so colors and progress bars keep working) | inherited | no |
| text with `--log` | piped, echoed to stdout, copied to the log | piped, echoed to stderr, copied to the log | yes |
| `--json` (no `--quiet`) | piped, echoed to **stderr** (stdout stays one object) | piped, echoed to stderr | yes |
| `--quiet` (any mode) | piped, not echoed | piped, not echoed | yes |
| `capture: true` | piped into `output`, not echoed | same | yes |

In every piped mode `--log` also gets a copy, and stdin is `ignore`. In inherit mode stdin is inherited, as today. A failed spawn (`ENOENT`) is `CommandError` "<command> was not found", hint "Install it, or check PATH." A non-zero exit with `reject` (the default) is `CommandError` "<command> exited with code N". Its `tail` holds the last `EXEC_TAIL_LINES` lines, and its hint is "Full log: <file>" with `--log`, or "Run again with --log <file> to keep its full output." without. A timeout kills the child and throws "<command> took longer than N s". The child is killed in `finally` if `run` throws while it is still running.

**`--quiet`.** It hides `ctx.warn`, the "Next:" lines, the every-run version warning, and every child's output (above). The result, under `--json` the envelope, and errors are always printed. `ctx.log` is unaffected in text mode: it is the command's result for people.

**`--log <file>`.** The path is relative to the current folder. The file is truncated at the start of the run and holds, in order: every `ctx.log` and `ctx.warn` line and every child's stdout and stderr, whatever `--quiet` hides. It is closed in `finally`. Its absolute path is in the envelope as `log`. A file that cannot be opened is a `CommandError` before `run` starts, hint "Check the folder exists and can be written." Like the other global flags, `--log` can come before the command (`art --log b.log dotcms build`). The leading-flag split of spec 01 learns that `--log` takes a value.

## Implementation plan

Branch `spec-03` from `main` once spec 02 is merged. Every step leaves `pnpm run test:all` green.

1. **Spec.** Commit this spec on `spec-03`.
2. **Global flags.** Add `dry-run`, `quiet` and `log` to `GLOBAL_FLAGS`. `defineCommand` rejects them, with the same messages as the other reserved flags. The leading-flag split (`splitLeadingFlags`) takes a value after `--log`. `--dry-run` and `--quiet` are parsed but do nothing yet. Tests: each is reserved; `art --log x.log hello` and `art hello --log x.log` parse the same; `--log` without a value is a usage error.
3. **Manifest fields and `--brief`.** `destructive` and `dryRun` in the definition types and in every full manifest entry (always booleans). `help --json --brief` and `help <topic> --json --brief` per the Data model. Text `help --brief` prints one line per command. Text command help shows "Destructive" and "Supports --dry-run" notes. Tests assert the fields a caller depends on, with no snapshots, and that a brief entry has none of the full-only keys.
4. **`destructive` enforcement.** The check before `run`, per Behavior, through the spec 02 prompt engine, and `ctx.invoke` passing `--yes` along. Tests, one per path: `--yes`, interactive yes, interactive no, non-interactive without `--yes` (exit 1, both hints when `dryRun` is supported), invoke without `--yes`.
5. **`--dry-run`, `ctx.dryRun`, `ctx.plan`.** The usage error on unsupported commands, `dryRun` and `plan` in the envelope, the text-mode plan list, no confirmation under `--dry-run`, and invoke of an unsupported command failing the caller. Fixture commands: one destructive with dry-run, one destructive without.
6. **`ctx.next`.** Collection, deduplication, the envelope key, the stderr "Next:" lines, discarded on failure and inside invoke, and the `TypeError` for a bad value.
7. **Exec edge.** `src/edges/exec.ts`: `spawn` with `shell: false`, inherit or piped stdio, a line splitter on piped output, kill on timeout (SIGTERM, then SIGKILL after `EXEC_KILL_GRACE_MS`). Tests run real tiny children (`process.execPath` with `-e` scripts): exit codes, interleaved output, ENOENT, timeout, and an argument with spaces and `$(...)` arriving unexpanded.
8. **`ctx.exec`.** `src/context/exec.ts` (pure) picks the mode from `json`, `quiet`, `log` and `capture` per the table, and keeps the tail ring (`EXEC_TAIL_LINES`, lines cut at `EXEC_TAIL_LINE_CHARS`). The failure carries `tail` into the envelope. Under `--dry-run` nothing starts. Tests per row of the table, with fake streams and the real tiny children.
9. **`--quiet` and `--log`.** `--quiet` hides `warn`, the "Next:" lines and child output. `src/edges/log-file.ts` opens the file before `run`, copies `log`, `warn` and child output into it, and closes it in `finally`. `log` goes into both envelopes. Tests: the log holds what `--quiet` hid; a folder that does not exist fails before `run`; the file is closed after a throw.
10. **Version checks (pure).** `src/utils/semver.ts`: parse, compare, and test each supported range form, with "not checked" for the rest. Tests one case each, including `||`, `1.x`, a prerelease, and `workspace:*`.
11. **Every-run warning.** `src/cli/version-warning.ts` on the shipped route: `range` and `installed`, one stderr line naming `art doctor`, hidden by `--quiet`, never in the envelope. Tests with temp projects: a range not satisfied, a different local copy, a local copy equal to the running one (no line), a project that does not depend on Artemis (no line), and `--json` with a mismatch (stdout is still exactly one object).
12. **`art doctor`.** `src/cli/doctor.ts` (pure, every check from what the edges read) and `doctor-command.ts`, wired in `launch.ts` beside `init` and `state`, on the shipped route only. It works with no project: `project` fails, and the checks that need one are left out. It warns when a project command or topic called `doctor` is hidden. It is added to `builtins` in the manifest. Tests per check and status, and the exit code with and without a failure.
13. **`art skill`.** `src/cli/skill.ts` (pure: manifest plus the project's `package.json` in, markdown out) and `skill-command.ts` (`--write`, never overwriting without the question or `--yes`, `--json`), shipped route only, and added to `builtins`. Tests: the frontmatter, the destructive section present and absent, examples capped at `SKILL_MAX_EXAMPLES`, no usage lines or flags anywhere, and an existing file left alone without `--yes` when not interactive.
14. **Docs.** README: a section "For agents" (`--brief`, then one command; `destructive`, `--yes` and `--dry-run`; `next`; `--quiet` and `--log`; `art skill`; `art doctor`), `ctx.exec`, `ctx.next`, `ctx.plan` and `ctx.dryRun` in the ctx table, the new global flags, and the new definition fields. AGENTS.md: "Calling a command" gains `--brief`, `next`, `plan`, `log` and `tail`, the destructive rule, and the three global flags, and "Adding a command" gains `destructive`, `dryRun`, `ctx.exec` (prefer it to `spawn`), `ctx.next` and `ctx.plan`.
15. **Checks and version.** `scripts/check-bin.mjs`:
    - `help --json --brief` in a temp project;
    - a destructive command run with `--json` and no `--yes` (exit 1 with the hint);
    - `--dry-run --json` (a `plan`, nothing changed on disk);
    - a command using `ctx.exec` on a child that prints 2,000 lines, with `--json --quiet` (stderr empty, the envelope still one object) and with `--log` (the file has 2,000 lines and the envelope names it);
    - `art skill`;
    - `art doctor` with a project that installs a different copy than the global one (an `installed` warning).

    Set `version` per the "Version" decision.
16. **Review and PR.** Run `/review-standards`, fix the findings, push `spec-03`, open one PR to `main`.

## Acceptance criteria

- [ ] `pnpm run test:all`, `build`, `check-exports`, `check-bin` and `check-lock` pass locally, and in CI on Node 22 and 24.
- [ ] `/review-standards` reports nothing open.
- [ ] `defineCommand` throws a `TypeError` for a command declaring `dry-run`, `quiet` or `log`.
- [ ] Every full manifest entry has `destructive` and `dryRun` as booleans, and every key spec 01 defined keeps its name and position.
- [ ] `help --json --brief` and `help <topic> --json --brief` return entries with only `id`, `description` and, when true, `destructive` and `dryRun`, plus `more`. No entry has `usage`, `args`, `flags`, `examples` or `aliases`. `--brief` outside `help` exits 2.
- [ ] A destructive command run without `--yes` and without a terminal (or under `--json`) exits 1 before `run` is called, with the hint "Pass --yes to confirm." (and the `--dry-run` hint when supported). With `--yes` it runs. In a terminal it asks, and "no" exits 1 with "Cancelled.".
- [ ] `--dry-run` on a command without `dryRun: true` exits 2 and `run` is never called. On one with it, nothing is asked, `ctx.exec` starts no process, and the envelope has `dryRun: true` and the `plan`.
- [ ] `ctx.invoke` of a destructive command without the caller's `--yes` asks again or fails the caller, and passes `--yes` and `--dry-run` when the caller has them.
- [ ] `ctx.next` lines appear once each, in order, as `next` in the success envelope, as "Next:" lines on stderr in text mode, and nowhere on failure or from inside an invoke.
- [ ] `ctx.exec` never uses a shell: an argument `"$(touch x) a b"` reaches the child as one unchanged string, and no file `x` appears.
- [ ] `ctx.exec` follows each row of the output table (one test per row). In text mode without `--quiet`, `--log` or `capture`, the child inherits the terminal, as `stdio: 'inherit'` does today.
- [ ] A child that exits non-zero fails the command with exit 1, `error` naming the command and code, and `tail` holding at most `EXEC_TAIL_LINES` lines of at most `EXEC_TAIL_LINE_CHARS` characters. A missing executable is "<command> was not found". A timeout kills the child and fails.
- [ ] With `--json --quiet`, a command whose child prints 2,000 lines writes nothing to stderr and exactly one object to stdout.
- [ ] With `--log <file>`, the file holds every `ctx.log` and `ctx.warn` line and all child output (even under `--quiet`), its absolute path is `log` in the envelope on success and failure, and a path whose folder does not exist fails before `run`.
- [ ] `semver.ts` decides exact, `^`, `~`, `>=`, `>`, `<=`, `<`, `*`, `x`-ranges and `||` correctly, and returns "not checked" for `workspace:`, `file:`, `link:`, git URLs, tags, space-joined ranges and prereleases.
- [ ] On the shipped route, a project whose range does not accept the running version, or whose installed copy differs from it, gets exactly one stderr line naming `art doctor`. Under `--quiet` there is none, and the JSON envelope never contains it.
- [ ] `art doctor` reports every check of the table with `ok`, `warn` or `fail` and a `fix` for each non-ok. It exits 0 with warnings only and 1 with a failure, works with no project (the `project` check fails), and is on the shipped route only.
- [ ] `art skill` prints the fixed template filled from the manifest: frontmatter with `name` and `description`, the destructive section only when a command is destructive, at most `SKILL_MAX_EXAMPLES` examples, and no usage lines, args or flags. `--write` never overwrites without the question or `--yes`. It is on the shipped route only.
- [ ] `builtins` in `help --json` lists `init`, `state`, `skill` and `doctor` on the shipped route, and a project command named `skill` or `doctor` is hidden there with a warning.
- [ ] README and AGENTS.md document everything above, and AGENTS.md tells agents to read `--brief` first.

## Decisions

- **Yes:** one spec for all of it (owner, 2026-11-11: "this is agent optimization"). Every item serves the same goal, the tokens an agent spends around a command, and they ship in one release. The cost is a long spec and a long PR. Each step stays independently green to keep it reviewable.
- **Yes:** `--brief` as a flag of `help` only, not global. It means nothing to any other command, and reserving one more name would cost commands a flag.
- **No:** a new single-command level. It exists (`help <command> --json`, `<command> --help --json`). The brief manifest's `more` key and the skill tell agents to use it.
- **Yes:** `destructive` asks in a terminal and needs `--yes` otherwise (owner, 2026-11-11). It is the same contract as every prompt, so agents already know the fix, and commands drop their hand-written confirms.
- **No:** always requiring `--yes`, even in a terminal. A person at a terminal can answer, and refusing them is friction with no safety gain.
- **No:** `destructive` as a manifest marker only. Unenforced, it is prose in another format.
- **Yes:** `--dry-run` is opt-in per command (owner, 2026-11-11), and a usage error elsewhere. The framework cannot know what an arbitrary command would do, and silently running a command that ignores `--dry-run` would be the worst possible failure.
- **Yes:** under `--dry-run`, `ctx.exec` records instead of running. Most of what a command does to the world goes through child processes, so the plan fills itself. A command that needs the child's output to continue checks `ctx.dryRun`.
- **Yes:** `next` in the envelope, set through `ctx.next` (owner, 2026-11-11). The result stays the command's own data, and every command gets the key in the same place.
- **Yes:** `ctx.exec` plus `--quiet` and `--log` (owner, 2026-11-11). Child output is the bulk of the flood, and it bypasses Artemis today, so flags alone could not reach it.
- **Yes:** inherit mode stays the default in a terminal. Piping would break children's colors and progress bars for people. Artemis pipes only when something needs the bytes (`--json`, `--quiet`, `--log`, `capture`).
- **Yes:** under `--json`, child stdout is echoed to stderr. Stdout must stay exactly one object, which is the core promise of spec 01.
- **Yes:** `--quiet` also hides `ctx.warn`. For an agent, the progress lines of the scripts repo (`ctx.warn('Starting Docker...')`) are the flood; errors and the result still come through, and `--log` keeps everything.
- **Yes:** no shell in `ctx.exec`. An argument array cannot be injected, and commands built by agents are exactly where untrusted strings end up in arguments.
- **Yes:** the failure envelope carries `tail`. The last lines of a failed build are usually all an agent needs, and a capped tail costs a fixed, small amount.
- **Yes:** `art skill` is a built-in word that generates the skill (owner, 2026-11-11). Generated from the manifest, it cannot drift, and a fixed template keeps it to about 30 lines.
- **No:** a `guide` field inside `help --json`. Agents load skills before they run anything, so a file is where the guidance gets read.
- **Yes:** a version warning on every run plus `art doctor` (owner, 2026-11-11). The warning catches the incident that happened (a stale `art` running silently), and the doctor explains it and checks the rest.
- **Yes:** the warning goes to stderr and never into the envelope, and `--quiet` hides it. The envelope's shape stays the command's; an agent that wants the details runs `art doctor --json`.
- **Yes:** our own small range checker, not the `semver` package. Spec 02 brought the runtime dependencies down to one with none of its own, and a warning only needs the common forms. Anything else is "not checked", never a false alarm.
- **Yes:** `skill` and `doctor` are reserved on the shipped route only, like `init` and `state` (spec 02). A published tool's command names stay its own.
- **Yes:** Version: `1.0.0` or `2.0.0`, by when it merges. Reserving `dry-run`, `quiet` and `log` breaks any command that declares one, which is a breaking change under semver even though no known command does (the scripts repo was checked on 2026-11-11). If this spec merges before `1.0.0` is tagged, it ships inside `1.0.0` (`package.json` stays `1.0.0`), because reserving names before the stable promise costs nobody. If `1.0.0` is already tagged, it is `2.0.0`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Piped children lose colors and progress bars | Only in modes where nobody watches a terminal (`--json`, `--quiet`, `--log`, `capture`). Text mode keeps inherit. |
| A child keeps running after Artemis fails or is interrupted | Killed in `finally`; a timeout sends SIGTERM, then SIGKILL after `EXEC_KILL_GRACE_MS`. Ctrl+C reaches inherited and piped children through the terminal's process group, as today. |
| A command needs a child's real output under `--dry-run` | `ctx.exec` returns `skipped: true` and empty output; the command checks `ctx.dryRun`. The README says so beside `capture`. |
| The version warning is noise in monorepos (`workspace:*`, `link:`) | Those forms are "not checked", never warned. |
| An agent ignores `next` and guesses anyway | The skill and AGENTS.md say to follow it; it is additive and costs nothing when ignored. |
| `tail` includes secrets a child printed | It is what the child already printed to the terminal. The cap limits it, and the README notes that `tail` and `--log` hold child output as is. |
| A destructive confirmation inside `ctx.invoke` surprises a caller that was already confirmed | Stated rule: a confirmation covers the named command only. The caller passes `--yes` along when the user gave it. |
| Reserving three flag names breaks an unknown user's command | The `TypeError` names the flag. The version rule (Decisions) makes it a major change if `1.0.0` is out. |
| The every-run warning reads `node_modules` on each start | One small `package.json` read on the shipped route only, alongside the one already read to find the project. |

## Handoff

- **Runs in:** the artemis checkout via `/spec-impl 03 delegated`, after spec 02 is merged.
- **Reads first:** `docs/CODE_STANDARDS.md`, specs 01 and 02 (the envelope, the built-in words, the prompt engine), and this spec's "Why this spec exists".
- **May:** create `spec-03` from `main`; commit each step; push `spec-03`; open one PR to `main`.
- **Must not:** merge; tag or release; publish; touch the scripts repo; add a dependency (none is needed); change specs 01 or 02.
- **Node versions:** the checks run on the machine's Node; CI proves 22 and 24. The report states the local version.
- **Stops and reports when:** a step needs a decision this spec doesn't make; spec 02 is not merged; a check fails twice.
- **Reports:** steps done, PR link, commands run with results, the measured sizes of `help --json` and `help --json --brief` on the fixture tree, open questions, bugs found by tests.

## What is **not** in this spec

- Kits that ship commands (its own spec).
- The store kit (spec 02).
- `skill` and `doctor` on published tools' own CLIs.
- Static `next` in definitions, structured progress events, a full semver parser.
- Moving the scripts repo onto `destructive`, `ctx.exec` and `ctx.next` (its own spec in that repo).

Each one, if it lands, goes in its own spec.
