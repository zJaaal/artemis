# SPEC 05 — Safety gaps: an audit trail at every level, destructive by call, Windows, a scaffold word and a changelog

> **Status:** Draft
> **Depends on:** SPEC 04 (released as `1.2.0`, merged in `fc34904`)
> **Date:** 2026-11-14
> **Source:** the owner's must-haves of 2026-11-14 (after 1.2.0 and the dotCMS tool upgrade), issue #11, and the first Windows CI run (draft PR #18)
> **Release:** `1.3.0`

## Why this spec exists

The README now sells three things: safe defaults that are enforced, one way to find tools, and a record of what ran. Upgrading a real tool (the owner's dotCMS environment, a published tool built with `cli({ root })`) to 1.2.0 showed where those promises stop:

- **The record of what ran skips published tools.** The audit trail and `art history` exist only on the shipped `art`. A tool, the shape any serious team ends up with, gets neither.
- **`destructive` is all or nothing.** `dotcms start` deletes data unless `--no-prune`. Marking it destructive would ask on every start, even with `--no-prune`; not marking it leaves the most dangerous everyday command unguarded. A command cannot decide for itself either, because `ctx` does not say whether `--yes` was passed.
- **Windows was never run.** The first CI run (PR #18) passes `tsc`, ESLint, Prettier, the build, `check-exports` and `check-lock`, and fails 76 of 2,247 tests and `check-bin`. Most failures are tests that assume POSIX; four are real (below).
- **Nothing says what changed between versions.** Three releases changed the manifest shape and reserved words, and the only record is PR descriptions.

Issue #11 (a scaffold word) rides along: an agent writing its own tooling should not have to remember the file layout. Out of the issue list, the owner closed #7 (MCP adapter: an architecture choice for the project using Artemis) and #8 (shell completion: terminals do it), and merged #9 and #10 into #17, which is not in this spec.

## Scope

**In:**

1. **Audit at every level.** A published tool turns the audit trail on with `"artemis": { "audit": true }` and then has the word `history`. `run()` callers get the documented `auditFile` option and an exported `readHistory`.
2. **Destructive by call.** `destructive` also takes a function of the call's `args` and `flags`.
3. **Windows.** The four real bugs fixed, the POSIX-only tests skipped with a reason, the rest of the tests made portable, and the Windows job required.
4. **`art new`.** A word of the shipped `art` that writes a new command file, never overwriting one.
5. **A changelog.** `CHANGELOG.md`, backfilled to 0.1.0, shipped in the package, and required by the release check.

**Out:** topic aliases and default commands (#17), TypeScript command files (#13), result schemas (#12), an MCP adapter and shell completion (closed), `ctx.yes` (see Decisions), auditing a tool by default, doctor's health checks for tools (`doctor` stays a word of the shipped `art`), Windows-only features (a native terminal kit for Windows Terminal, PowerShell completion).

## 1. Audit at every level

### Where the trail is written

| Route | When | File |
| --- | --- | --- |
| Shipped `art` | always, unless `"audit": false` (unchanged) | `<stateDir>/audit.jsonl` of the project |
| Tool, `cli({ root })` | only with `"audit": true` in the tool's own `package.json` | `<stateDir>/audit.jsonl` of the tool's package |
| `run(argv, options)` | only when `options.auditFile` is given (unchanged, now documented) | `options.auditFile` |

- `stateDir` resolves as it does today: relative to the folder of that `package.json`, default `state`. For a tool installed from npm that folder is inside `node_modules`; the docs say to set an absolute `stateDir` (or keep auditing off) for such a tool. Nothing detects it.
- The line format, what is recorded and what is not, the rotation at 1 MB and the failed-write warning are those of SPEC 04, unchanged, on every route.
- `"audit"` keeps its validation (`true` or `false`, anything else is the existing invalid-config error). On the shipped route `true` is the same as leaving it out.

### `history` on a tool

With auditing on, `history` is a word of the tool, exactly as on the shipped `art`:

- `<bin> history [command words]... [--limit <n>] [--json] [--quiet]`, the same output, filters, `--limit` rules, flag refusals (`--dry-run`, `--log`, exit 2) and `--help` text, with the tool's `bin` in usage lines.
- It reads the tool's own trail. It needs the tool's project, not a commands folder that loads (as today).
- A tool command or topic named `history` is hidden behind the word, with the shipped warning text on stderr (`--quiet` hides it). The tool's author opted in, so the word wins.
- The tool's `help` lists the word: the brief listing and `help --json` gain `builtins: ["history"]` (today a tool has no `builtins` key), and text help shows it where the shipped `art` shows its words.
- Without auditing, a tool reserves nothing (unchanged): no `history` word, no `builtins` key.

**Implementation note:** `historyCommand` stops finding the project from the current folder. The launcher passes it the project it already resolved (by route), so the same code serves both routes.

### `readHistory` for `run()` callers

`import { readHistory } from '@zjaaal/artemis'`:

```ts
readHistory(auditFile: string, options?: { command?: string; limit?: number }): { entries: AuditLine[]; skipped: number }
```

- The lines of `auditFile`, newest first, filtered to the command id `command` (an id: aliases are the caller's to resolve, from its own registry), at most `limit` (default `HISTORY_DEFAULT_LIMIT`, 20). The same `entries` and `skipped` as `art history --json`.
- A missing file is `{ entries: [], skipped: 0 }`. An unreadable one throws the `CommandError` that `art history` throws today. A `limit` that is not a whole number above 0 is a `TypeError`.
- `AuditLine` is exported as a type.
- docs/run.md documents `auditFile` and `readHistory`, with a five-line example of a `history` command file built on them.

## 2. Destructive by call

```js
export default defineCommand({
    description: 'Start dotCMS (data is pruned unless --no-prune)',
    destructive: ({ flags }) => !flags['no-prune'],
    flags: { 'no-prune': { type: 'boolean', description: 'Keep the data' } },
    run({ flags, ctx }) { ... }
});
```

- `destructive` is `true`, `false` (default) or a function `({ args, flags }) => boolean`. `args` and `flags` are typed from the definition, exactly as in `run`. Any other value is the existing `TypeError` from `defineCommand`.
- **When it is called:** once per call, after the command line parsed and before the confirmation step, with the parsed `args` and `flags` (defaults applied). Never for `--help`, help listings, a usage error or a dry run decision that does not need it. Under `--dry-run` it is still called (the audit line records what was asked) but nothing is asked, as today.
- **Its answer** feeds the confirmation exactly as `true` or `false` does today: `true` asks in a terminal, runs with `--yes`, and is refused with the existing hint when nobody can answer.
- **A function that throws, or returns anything but a boolean,** is a bug in the command: the call fails before `run` the way a plain `Error` from `run` does (exit 1, a stack). The non-boolean case throws `TypeError: destructive() of "<id>" returned <value>; it must return true or false`.
- **`ctx.invoke`** calls the invoked command's function with that command's own parsed `args` and `flags`.
- **Everywhere a command is described** (help text, `help --json`, the brief listing, `art skill`, doctor's `history-previewed` check), a function counts as `destructive: true`: the command can change or delete data, and the reader cannot run the function. Text help prints the existing Destructive line followed by `(depends on the arguments and flags)`; the manifest stays `destructive: true` (no new key).
- The type of `destructive` in the `defineCommand` input widens; the output definition keeps the value as given (a boolean or the function).

## 3. Windows

The first CI run on `windows-latest` (Node 24) sorted into these. Each fix below has a test that runs on the Windows job.

### Real bugs

**W1. `ctx.exec` cannot start `.cmd` and `.bat` files.** `npm`, `pnpm`, `npx`, `yarn` and everything in `node_modules/.bin` are `.cmd` shims on Windows. Node refuses to spawn them without a shell (EINVAL since the 2024 security release), and `ctx.exec` never uses one, so `ctx.exec('pnpm', ['build'])` fails on Windows.

- On `win32` only, before spawning, `ctx.exec` resolves a bare command (no path separator, no extension) through `PATH` and `PATHEXT` (default `.COM;.EXE;.BAT;.CMD`), in the call's `cwd` and `env`. A command with a path or an extension is used as given.
- When the resolved file is `.cmd` or `.bat`, it runs as `cmd.exe /d /s /c "<file> <args>"` with `windowsVerbatimArguments: true`, every argument quoted and escaped so `cmd.exe` interprets none of it: the rules `cross-spawn` uses (double quotes and backslashes escaped for the program, then every `cmd.exe` metacharacter `( ) % ! ^ " < > & |` prefixed with `^`, and the file path escaped the same way). Artemis implements them itself, about 40 lines in `src/utils/`, pure, with tests of each metacharacter.
- The promise "never through a shell" becomes, for Windows `.cmd` files only, "through `cmd.exe` with every argument escaped so nothing is interpreted". docs/commands.md says so.
- `.exe` and `.com` files spawn directly, as on every other platform. A command not found keeps the existing not-found error.
- The same resolution applies to the detached spawn (`detached: true`).

**W2. The worktrees kit compares paths as strings.** Windows paths ignore case and have short forms (`C:\Users\RUNNER~1\...` and `C:\Users\runneradmin\...` are one folder), so the main checkout was "a worktree with no instance yet".

- Every path the kit compares or stores as an identity (a checkout root, `mainCheckout`, the root `git` reports) goes through one `samePath` helper: `fs.realpathSync.native` (which expands short names and fixes case to what the disk says), then on `win32` a case-insensitive comparison. A path that does not exist falls back to `path.resolve`.
- Stored registry entries are not rewritten; they are compared through the same helper.

**W3. The store's atomic write fails while another process reads the file.** `rename` over a file another process has open is `EPERM` (or `EACCES`, `EBUSY`) on Windows.

- On `win32`, `writeAtomic` retries the rename on those three codes, `ATOMIC_RENAME_RETRIES` (10) times, `ATOMIC_RENAME_RETRY_MS` (20) apart, then throws the last error. The staging file is removed in `finally`, as today. Other platforms are unchanged.

**W4. Stopping a child does not stop its children.** Windows has no process groups, so when `run` ends, a child `ctx.exec` started is killed but what it started (a dev server's workers) survives.

- On `win32`, stopping a child (the end of `run`, a timeout) runs `taskkill /pid <pid> /T /F` through the existing quiet-spawn edge, which ends the whole tree. The polite first step of other platforms (a signal, then a wait) is skipped: Windows has no polite signal for a console process.
- A detached child (`detached: true`) is never stopped by Artemis, on any platform (unchanged).
- A signal name in an error (`killed by SIGTERM`) can only come from POSIX; on Windows a killed child is reported by its exit code.

### Tests that assume POSIX

- **Fake file systems keyed by `/work/app`-style paths** (`settings.test.ts` and the init and agent-pointer tests): the fakes and expectations are built with `path.resolve`, so they hold on both.
- **Regular expressions built from a path** (the store's corrupt-document test and others): the path is escaped first, with one test helper.
- **Permission tests that use `chmod`** (no-access folders, a script without the execute bit): skipped on `win32` with the reason in the test name's skip message, the way they already skip as root.
- **Signals, process groups, symlink loops, and a process owned by another user:** skipped on `win32` with a reason.
- **`scripts/check-bin.mjs`** spawns `npm` directly: on `win32` it runs `npm.cmd` through the same escaping rules (or `shell: true` with fixed arguments; it is a script of the repo, not shipped code).

### The job

When every step is green, the Windows job joins the required matrix: `windows-latest` with Node 24, every step of the Linux job except the staging dry run. `continue-on-error` goes away.

## 4. `art new`

A word of the shipped `art`, next to `init`, that writes one command file:

```
art new <command words>... --description <text> [--arg <name>]... [--flag <name>]... [--destructive] [--supports-dry-run] [--json] [--quiet]
```

```console
$ art new db reset --description "Delete the local database and rebuild it" --destructive --supports-dry-run
Created /work/app/commands/db/reset.js
Next: art db reset --help
```

- **Words:** one or more, each matching `^[a-z0-9][a-z0-9-]*$`. The first word may not be a word of the shipped binary (`help`, `init`, `state`, `skill`, `doctor`, `history`, `new`): that is a usage error (exit 2) whose hint says the command would be hidden.
- **`--description`** is required and one line (no newline); missing or empty is a usage error (exit 2).
- **`--arg <name>`** (repeatable, in order) adds a required argument; **`--flag <name>`** (repeatable) adds a boolean flag. Names match `^[a-z][a-z0-9-]*$`. A flag named after a reserved flag (`help`, `json`, `yes`, `dry-run`, `quiet`, `log`), a duplicate name, or an arg and a flag with one name is a usage error (exit 2). Args and flags get the description `TODO: describe`.
- **`--destructive`** writes `destructive: true`; **`--supports-dry-run`** writes `dryRun: true` and a `ctx.plan` / `ctx.dryRun` block. They are independent.
- **The file** is `<commandsDir>/<word 1>/.../<word n>.js`. Missing folders, the commands folder included, are created. It refuses (exit 1, nothing written) when the file exists, or when a folder `<word n>` exists in the same place (a topic of that name). It never overwrites anything.
- **The project** is found as `art state` finds it: no project is the existing no-project error (exit 1), whose hint mentions `art init`.
- **Output:** `Created <file>` and a `Next:` line `<bin> <words> --help` (hidden by `--quiet`). Under `--json`: `{ "ok": true, "command": "new", "result": { "id": "db reset", "file": "<absolute path>" }, "next": ["<bin> db reset --help"] }`.
- It takes no `--yes` (nothing to confirm: it never overwrites), and refuses `--dry-run` and `--log` like every built-in word (exit 2).
- It is a word of the shipped `art` only: a tool reserves nothing (unchanged), and doctor's shadow check and the "words" list gain `new`.

**The template** (exactly this, with the parts in brackets present only when their flag was given, and `run`'s parameter listing only what exists):

```js
// @ts-check
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: '<description>',
    [destructive: true,]
    [dryRun: true,]
    [args: [{ name: '<arg>', required: true, description: 'TODO: describe' }],]
    [flags: { '<flag>': { type: 'boolean', description: 'TODO: describe' } },]
    run({ [args, ][flags, ]ctx }) {
        [ctx.plan('TODO: describe each step this command takes');
        if (ctx.dryRun) {
            return null;
        }

        ]// TODO: the work. ctx.exec runs a program; throw new CommandError(message, { hint }) for a failure the caller can fix.
        return [{ args, flags }|null];
    }
});
```

- The description is written as a single-quoted JavaScript string, with `\` and `'` escaped. Flag keys are always quoted.
- The file is Prettier-clean under the repo's own settings, loads, and `art <words> --help` exits 0. When it has no args, `art <words> --json` exits 0 (`--yes` too when destructive).
- The return is `{ args, flags }` with only the keys that exist, or `null` when neither does.
- **Docs:** `help --authoring` (AGENTS.md "Adding a command") and the generated skill's "Writing a command" section mention `art new`. The init pointer mentions it only if it stays under `INIT_POINTER_MAX_BYTES` with the default bin; otherwise it is left as is.

## 5. A changelog

- **`CHANGELOG.md`** at the repository root, newest first. Each release is `## <version> (<YYYY-MM-DD>)`, the date of its tag, with the sections that apply, in this order: `Breaking`, `Added`, `Changed`, `Fixed`. Each entry is one line, and a breaking entry links to its section of docs/upgrading.md. An `## Unreleased` section at the top collects merged work.
- **Backfilled** from the tags, the release PRs and docs/upgrading.md: 0.1.0 (tagged 2026-11-10, staged but never published, said so in one line), 0.1.1, 0.1.2, 1.0.0, 1.1.0, 1.2.0. 1.3.0 is this spec.
- **Shipped:** `CHANGELOG.md` joins `files` in `package.json`.
- **Enforced:** the release check fails a PR labelled `release` whose `CHANGELOG.md` has no line starting with `## <new version> (`. The message says to move the Unreleased entries under that heading. A PR without the label is not checked.
- CONTRIBUTING.md: a PR that changes behavior adds a line under Unreleased; a release PR moves them under the version.

## Implementation plan

Branch `spec-05`, cut from `main` at `fc34904`, with the Windows CI commit of PR #18 on it. Every step leaves the Linux jobs green and is one commit; the Windows job is allowed to fail until step 7.

1. **Spec.** This file.
2. **Changelog (5).** `CHANGELOG.md`, `files`, the release-check rule, CONTRIBUTING. Test the rule by hand on the PR (it is a workflow script).
3. **Destructive by call (2).** `defineCommand` validation and types (`define.test-d.ts`: the function's `args` and `flags` are typed, a wrong return type is a type error), the call in `execute` before `confirmDestructive`, every describer treating a function as `true`. Tests: true and false answers in a terminal, with `--yes`, with nobody to answer, under `--dry-run`; a throw; a non-boolean; through `ctx.invoke`; help, manifest, brief, skill, doctor.
4. **Audit at every level (1).** The tool route reads `"audit": true`; `history` on a tool, with the project passed in; `builtins` on a tool with auditing; `readHistory`. Tests: a tool with and without auditing (file written or not, word present or not, `builtins` key), a tool command named `history` hidden with the warning, `readHistory` filters, limit, missing file, bad limit; `cli({ root })` still writes nothing by default.
5. **`art new` (4).** `src/cli/new.ts` (pure: words to a path and the template text) and `src/cli/new-command.ts` (the word). Tests: every usage error, every refusal, nested topics, created folders, each template variant run through `defineCommand` and through `art` (help exits 0, a no-arg command runs), the JSON shape, the reserved-word list, doctor's shadow check.
6. **Windows fixes (3, W1 to W4).** One commit per bug, each with its tests. W1's escaping is pure and tested on every platform; its spawning is tested on the Windows job (a `.cmd` file that echoes its arguments, with every metacharacter).
7. **Windows tests (3).** Portable fakes, escaped regexes, the skips, `check-bin`. The Windows job goes green and becomes required.
8. **Docs and version.** AGENTS.md (calling: `history` on tools; adding a command: `art new`, `destructive` as a function), docs/commands.md (`destructive` function, `ctx.exec` on Windows), docs/cli.md (`art new`, `history` on tools), docs/run.md (`auditFile`, `readHistory`), docs/project.md (`audit: true` for tools), docs/upgrading.md ("to 1.3": `new` is a reserved word), README (Windows in Requirements, `art new` in Quick start), CHANGELOG 1.3.0. Version `1.3.0` in a PR labelled `release`.

## Acceptance criteria

- `pnpm run test:all`, `build`, `check-exports`, `check-bin` and `check-lock` pass on Linux (Node 22 and 24) and on Windows (Node 24), all required.
- A tool with `"audit": true` records a run, and `<bin> history --json` returns it; the same tool without the setting writes no file and has no `history` word.
- A command with `destructive: ({ flags }) => !flags.keep` refuses `--json` without `--yes`, and runs `--keep --json` without `--yes`.
- `ctx.exec('npm', ['--version'])` succeeds in a command run by the packed `art` on Windows (a `check-bin` case), and a `.cmd` echoing its arguments receives `a&b`, `%PATH%`, `"q"` and `^` unchanged.
- `art new x y --description "d" --arg a --flag f --destructive --supports-dry-run` writes a file that `art x y --help` describes, and a second identical call exits 1 with the file untouched.
- A release PR without its `## <version> (` heading in CHANGELOG.md fails the release check.

## Decisions

- **One spec for the must-haves plus #11** (owner, 2026-11-14). #9 and #10 merged into #17 and left out; #7 and #8 closed.
- **Auditing is opt-in for tools,** off by default: a tool installed from npm would otherwise write into `node_modules`. The owner's own case (a tool run from its checkout) turns it on with one key.
- **`history` comes with the audit on a tool, and wins over a command of that name.** The author asked for it. Without auditing, a tool still reserves nothing.
- **`run()` gets `readHistory`, not a built-in word:** a `run()` caller owns its bin and its words, and a five-line command file on `readHistory` is its `history`.
- **`destructive` as a function, not `ctx.yes` or `ctx.confirm`:** the decision stays declarative and before `run`, so the confirmation, the dry-run refusal and the audit line work as they do for `true`, and a command never half-runs before asking. A command that only learns mid-run that it will delete something is not served; no case of it is known.
- **The manifest says `destructive: true` for a function:** an agent cannot run the function, so it reads "can delete". Passing `--yes` when it was not needed costs nothing.
- **Windows `.cmd` support is written in Artemis, not taken from `cross-spawn`:** the escaping rules are small and well known, and Artemis keeps one runtime dependency. The rules follow `cross-spawn`'s, and the tests pin each metacharacter.
- **The word is `new`:** short, and what people type in other tools (`ng new`, `cargo new`). It reserves one more name on the shipped `art`; doctor reports a command that it hides.
- **The scaffold writes a working stub, not a template full of options:** an agent edits code better than it fills a questionnaire, and the stub passes `defineCommand` and runs.
- **The changelog is checked only on release PRs:** a PR without the label stays free to merge, and the release PR is where the entries are gathered.

## Risks

- **The `cmd.exe` escaping is security-sensitive.** A mistake lets an argument run a command. Mitigated by following `cross-spawn`'s rules, pinning each metacharacter in tests, and a Windows test that passes them through a real `.cmd`.
- **`taskkill /T /F` is abrupt:** a child gets no chance to clean up. Windows offers nothing gentler for console processes; the docs say so.
- **Path identity through `realpath`** costs a file system call per comparison in the worktrees kit. Its callers compare a handful of paths per run.
- **A tool's `history` word can hide a command its author forgot about.** The warning names it, and the author opted in.
- **The backfilled changelog can miss an entry.** It is written from the release PRs and the upgrade notes, which list every breaking change.
