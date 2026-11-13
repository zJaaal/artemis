# SPEC 04 — Agent findings: discovery that does not make agents guess, search, long-running children, buried errors, the agent pointer, an authoring nudge, an audit trail and command health

> **Status:** Approved
> **Depends on:** SPEC 03 (merged in `43b8993`)
> **Date:** 2026-11-13
> **Source:** issue #15 (fixes 1 to 14), from two internal benchmarks of headless Claude Code on a synthetic project
> **Release:** `1.2.0` (the shape of `help --json` changes; Artemis has no outside users yet, the same reasoning as 1.1.0)

## Why this spec exists

Two benchmarks (about 1,700 agent runs, Haiku and Sonnet, every result checked by code) measured what Artemis does for an agent. What held up:

- Commands an agent writes with Artemis keep the safety parts that its bash scripts drop (refusing a destructive run without confirmation 20/20 against 6/20, a dry run that changes nothing 20/20 against 10/20, `--help` 49/49 against 3/49).
- A destructive marker in the manifest is followed more consistently than the same rule in a doc (a preview before a database reset 5/5 against 2/5).
- A command saves money only when it replaces several steps (about −30 to −50% per repetition on multi-step jobs, nothing on one-call jobs), and a command shaped to the agent's question beats a general one (a self-written `build diagnose` at one call against five).

What cost Artemis its share, against plain scripts, is **discovery**: guessing flags the brief listing does not show, usage errors that say what is wrong but not what is right, a heavy single-command entry, and `help --agents` printing 15 KB mostly about writing commands. Each fix below is from issue #15, which has the evidence for it. The owner chose (2026-11-13) to do all fourteen in one spec, then run the benchmarks again.

Earlier owner decisions that bound this spec: no permission hooks and no destructive levels ("destructive is destructive"), secrets in arguments are not a concern (everything is local), Node only, and no `tags` field for search.

## Scope

**In:**

1. The brief listing shows how to call each command, flags included.
2. A usage error carries a hint with what is valid.
3. Manifest entries drop keys that hold their default.
4. `help --agents` prints only the calling contract; `help --authoring` prints the writing part.
5. The brief listing is measured, and keys that repeat are stated once.
6. `ctx.exec(..., { detached: true, logFile })` starts a child meant to outlive the command.
7. `ctx.exec(..., { errorPattern })` keeps the matching lines of a failed child next to its `tail`.
8. Above a number of commands, the top brief listing shows topics, not commands.
9. A size budget for what agents load up front (the generated skill, the init pointer).
10. `help --search <words>`: the best few commands for an intent.
11. `art init` writes the agent pointer.
12. The generated skill gains a short "write a command" section.
13. An audit trail, `<stateDir>/audit.jsonl`, and the built-in word `art history`.
14. `art doctor` reports command health from the audit trail.

**Out:** an MCP adapter (#7), shell completion (#8), a `keywords` field, embeddings or any model for search, running commands from doctor (the issue's "next steps"), the benchmark changes (they live outside the repo).

## Data model

### Brief entry (fixes 1, 5)

```jsonc
{ "id": "artifacts prune", "description": "Delete build artifacts older than a number of days",
  "usage": "artifacts prune [--older-than <days>] [--all]", "destructive": true, "dryRun": true }
```

- `usage` is new: the id, then each arg (`<name>` required, `[name]` optional, `<a|b>` when it has choices), then each command flag (`[--name]` for a boolean, `[--name <value>]` for a string, the value written as `<a|b>` when it has choices, `...` after it when `multiple`). No bin in front (the listing states `bin` once), no global flags (stated once, below), and no `[flags]` placeholder.
- `destructive` and `dryRun` stay as in spec 03: present only when `true`.

### Brief listing (fixes 5, 8)

```jsonc
{ "bin": "art",
  "topics": [{ "id": "db", "description": "The local database", "commands": 4 }],
  "commands": [ /* brief entries */ ],
  "builtins": ["init", "state", "skill", "doctor", "history"],
  "globalFlags": "--json --yes --dry-run --quiet --log <file> --help",
  "more": "art help <command> --json",
  "search": "art help --search <words> --json" }
```

- A topic with no description has no `description` key. `commands` is the number of commands under it (nested topics included).
- `builtins` becomes a list of ids (each has `art <word> --help --json`). The descriptions stay in the full `help --json`.
- `globalFlags` is new: one string, so a caller never has to look them up.
- `search` is present only when the listing is folded (below).
- **Folding:** when the project has more than `BRIEF_FOLD_THRESHOLD` commands (40), the top-level brief listing lists the topics with their counts and only the commands that sit in no topic, and `more` becomes `"art help <topic> --json --brief"`. `help <topic> --json --brief` is never folded. Text `help --brief` folds the same way.

### Full manifest entry (fix 3)

A key whose value is its default is left out: `aliases` when empty, `examples` when empty, `destructive` and `dryRun` when `false`; on an arg, `required` when `false`, `default` and `choices` when `null`; on a flag, `short`, `default` and `choices` when `null`, `multiple` when `false`. `id`, `description` and `usage` are always there, and so are `args` and `flags` (possibly empty), so a caller can tell "no flags" from an old Artemis. The types in `models.ts` mark the left-out keys optional. This applies to every `help --json` level and to `art <word> --help --json`.

### Usage error envelope (fix 2)

```jsonc
{ "ok": false, "command": "artifacts prune", "error": "Unknown option '--days'",
  "hint": "artifacts prune [--older-than <days>] [--all]. Global: --json --yes --dry-run --quiet --log <file> --help" }
```

Every usage error on a resolved command (unknown flag, missing or extra argument, a bad choice, a flag missing its value) gets a `hint` with the brief `usage` and the global flags, unless the error already has a hint of its own. The text output prints the same hint under the error, where today it prints `Usage`. An unknown command keeps its current behavior, and gains a hint naming the closest ids when any id shares a word with what was typed (at most 3), else "Run art help --json --brief."

### Search result (fix 10)

```jsonc
{ "ok": true, "command": "help",
  "result": { "query": "delete old build artifacts", "matches": [ /* brief entries, best first */ ], "more": "art help <command> --json" } }
```

- **Words:** the query and each command's text are lowercased and split on anything that is not a letter or digit. Words under 3 characters and a fixed stop list (`SEARCH_STOP_WORDS`: the, and, for, with, from, into, that, this, all, any) are dropped. A query word matches a command word when they are equal, or when the shorter has at least 4 characters and is a prefix of the longer (`build` matches `builds`, `artifact` matches `artifacts`).
- **Text of a command:** its id, aliases, description, examples, and its args' and flags' names and descriptions. Its topic's description counts too.
- **Score:** the number of distinct query words that match, plus one when a query word matches a word of the id. Commands scoring 0 are left out. Ties go by id. At most `SEARCH_MAX_MATCHES` (5).
- No match is `ok: true` with `matches: []`, exit 0, and in text mode a line "No command matches. Run art help --brief." Builtins are not searched.
- `--search` is a flag of `help` (like `--brief`), never a reserved word. It takes one value (quote the words). `help <topic> --search` searches inside the topic. `--search` with `--brief` or `--agents` is a usage error.

### Exec options (fixes 6, 7)

```ts
type ExecOptions = {
    // ...the spec 03 options
    detached?: boolean; // the child outlives the command
    logFile?: string; // required with detached: where its stdout and stderr go (appended)
    errorPattern?: RegExp; // a failed child keeps the lines matching it
};
```

- **`detached: true`** starts the child in its own process group with its stdout and stderr appended to `logFile` (resolved against `cwd`, folders created), `stdin` ignored, and resolves at once to `{ code: null, output: '', skipped: false, pid }`. It is never killed when `run` ends and never awaited. Artemis does not track it: the command records the `pid` (the store kit is the place) and offers its own stop command. `detached` without `logFile`, or with `capture`, `readOnly`, `timeoutMs` or `reject: false`, is a `TypeError`. Under `--dry-run` it is planned and skipped like any other call ("start <command> in the background, output in <logFile>"). A child that fails to start (spawn error) is a `CommandError`, as today.
- **`errorPattern`**: on a failure (non-zero exit or timeout), the lines of the child's output that match it, at most `EXEC_ERROR_LINES` (20) of at most `EXEC_TAIL_LINE_CHARS` each, the first ones kept, go into the `CommandError` as `errorLines`, and out as `errorLines` in the envelope after `tail`. It reads the whole output as it streams, so it works where the 40-line tail cannot reach. It is ignored with `detached`, and when it matches nothing the key is left out. A `RegExp` with the `g` or `y` flag is a `TypeError` (they make `test` stateful).

### Audit line (fix 13)

```jsonc
{ "time": "2026-11-13T10:02:11.391Z", "command": "db reset", "argv": ["--yes"], "dryRun": false, "yes": true,
  "exitCode": 0, "ms": 1840, "plan": ["delete .data/db.json"], "error": "..." }
```

- One line per run of a **project command** through the shipped `art` or `cli()`, after it ends (success, failure or usage error on a resolved command), appended to `<stateDir>/audit.jsonl` (folder created). `argv` is what followed the command id, with global flags removed. `plan` only on a dry run, `error` only on a failure. Help, built-in words and unknown commands are not recorded. A command run through `ctx.invoke` is not a separate line.
- `run()` records only when given `auditFile` (an absolute path); `cli()` and `art` pass `<stateDir>/audit.jsonl`.
- `"artemis": { "audit": false }` turns it off. A write that fails warns once on stderr (hidden by `--quiet`) and never changes the exit code or the envelope.
- When the file passes `AUDIT_MAX_BYTES` (1 MB) before an append, it is renamed to `audit.1.jsonl` (replacing an older one) and a new file starts.
- `art state` ignores both files (they are not store documents).

### `art history` (fix 13)

`art history [<command>] [--limit <n>] [--json]`: the newest lines first, default limit 20, filtered to one command id (or alias) when given. Text: one line per run (time, command, `dry run` or the exit code, the arguments). `--json`: `{ entries: [...] }` with the audit lines as written. No audit file: an empty list, and in text "Nothing recorded yet." A line that cannot be parsed is skipped and counted as `skipped` in the result. It is a built-in word of the shipped `art`, like `state`: reserved, listed under `builtins`, checked by doctor's shadow check, refuses `--dry-run` and `--log`.

### Doctor health checks (fix 14)

Read from the audit trail; warnings only, never a failure, each with a `fix`:

- **failing:** the last `HEALTH_FAILING_RUNS` (3) real runs of a command all exited non-zero. Fix: "Run art history <id> to see the errors."
- **only previewed:** a `destructive` command with at least 3 dry runs and no real run. Informational: "never run for real".
- **stale:** a command whose last run is older than `HEALTH_STALE_DAYS` (60). Fix: "Delete the file if it is no longer used."
- **gone:** a command id in the history that no longer exists is ignored.

No audit file: one `ok` check "no history yet". Doctor never runs a command.

### `help --agents` and `help --authoring` (fix 4)

- `help --agents` prints the "Calling a command" section of the shipped AGENTS.md, under one line naming the other part: "To write a command: art help --authoring".
- `help --authoring` prints the "Adding a command" section.
- Both are found by their `## ` headings when the file is read. A missing heading is a bug (a test reads the shipped file).
- The README, AGENTS.md and the generated skill point agents that only call commands to `help --json --brief`, and to `help --authoring` for writing them.

### Generated skill (fixes 9, 12)

`art skill` keeps its calling part and gains a section of at most `SKILL_AUTHORING_LINES` (15) lines:

> **Write a command when you do the same job twice.** If you ran the same steps twice in a session, put them in `commands/<topic>/<name>.js` and call that instead. `art help --authoring` has the rules: a one-line `description`, `args` and `flags` with descriptions, `destructive: true` for anything that deletes, `dryRun: true` with `ctx.plan` and `ctx.dryRun`, `ctx.exec` for child processes, and `CommandError(message, { hint })` for a failure the caller can fix. Make the result answer the question you ran it for, not a log.

A test checks the whole generated skill for the fixture project stays under `SKILL_MAX_BYTES` (4 KB).

### Init pointer (fixes 9, 11)

`art init` also adds, to the project folder:

```md
## Commands

This project's commands run through `art`. Start with `npx art help --json --brief`, call one with `--json`, and pass `--dry-run` before `--yes` on a destructive one. To write a new one: `npx art help --authoring`.
```

- It is appended to `AGENTS.md`, and to `CLAUDE.md` when that file exists and does not import `@AGENTS.md`. With neither, `AGENTS.md` is created.
- A file that already contains `art help` is left alone. It never rewrites a line, only appends (with one blank line before).
- Its output and `--json` result name each file created or changed, like the other files.

## Behavior

- **Order of a usage error:** the parse fails, the hint is built from the definition, the envelope or text goes out, exit 2, and the audit line is written (fix 13).
- **Search and folding never change exit codes.** Search is help: exit 0 unless the command line is wrong.
- **The audit write is the last thing a run does**, after the envelope is printed, so a slow disk never delays the result, and a failure to write never changes it.
- **Detached children and `--log`:** a detached child's output goes only to its `logFile`, never to the `--log` file or the terminal.

## Implementation plan

Branch `spec-04`, cut from `housekeeping` (PR #14). Every step leaves `pnpm run test:all` green, and each is one commit.

1. **Spec.** This file.
2. **Manifest defaults (3).** Types optional, builders leave defaults out, every consumer (`art skill`, text help, doctor, brief) reads a missing key as the default. Tests: an entry with every default has only `id`, `description`, `usage`, `args`, `flags`; each key appears when set.
3. **Brief usage, global flags, builtin ids (1, 5).** Tests: `usage` for each arg and flag shape (required, optional, choices, multiple, boolean); no topic `description` when empty; `globalFlags` once; a size test on the `src/test/fixtures` tree recording the bytes before and after in the commit message.
4. **Usage hints (2).** Tests: one per usage-error kind has the hint, a command error keeps its own hint, the unknown-command hint with and without close ids, text mode prints the hint.
5. **Folding (8).** A generated fixture of 200 commands in 10 topics (built in the test, not committed as 200 files). Tests: 40 commands not folded, 41 folded; the topic counts; `help <topic> --json --brief` lists commands. Record the folded and unfolded sizes in the commit message.
6. **Search (10).** Pure scoring in `src/help/search.ts` with tests per rule (stop words, short words, prefixes, id bonus, ties, limit, topic scope, no match, the flag clashes).
7. **`--agents` and `--authoring` (4).** Tests read the shipped AGENTS.md: each prints its section only.
8. **Exec `detached` (6).** Tests: resolves with a pid while the child keeps running, the log file gets its output, `run` ending does not kill it (the test kills it), each `TypeError`, dry-run plans it.
9. **Exec `errorPattern` (7).** Tests: a match at line 1,800 of 2,000 is in `errorLines`, at most 20 kept, absent on success and when nothing matches, `g` flag rejected, the envelope carries it.
10. **Audit and `art history` (13).** Tests: a line per run with each field, usage error recorded, help and builtins not, `audit: false`, rotation at the limit, a failed write warns and keeps the exit code, `history` filters, limits, skips bad lines, and its reserved-word rules.
11. **Doctor health (14).** Tests: each check from a written audit file, gone commands ignored, no file.
12. **Skill and init pointer (9, 11, 12).** Tests: the authoring section, the size cap, every init case (none, AGENTS.md only, CLAUDE.md with and without the import, already has `art help`, run twice).
13. **Docs.** AGENTS.md, docs/cli.md, docs/commands.md (exec options), README "For agents", docs/upgrading.md ("to 1.2": the manifest keys left out, `history` reserved), and the version to `1.2.0` in a PR labelled `release`.

## Acceptance criteria

- `pnpm run test:all`, `build`, `check-exports`, `check-bin` and `check-lock` pass.
- On the issue's case, `artifacts prune --days 30` fails with a hint showing `--older-than`, and `help --json --brief` shows `--older-than` without another call.
- The brief listing of a 200-command project is smaller than `BRIEF_FOLD_THRESHOLD` commands' worth, and `help --search` returns at most 5 entries whatever the project size.
- `help --agents` is under 4 KB.
- A detached child started by a command is still running after `art` exits.
- A failed build whose only error line is far above the tail returns that line in `errorLines`.
- Every project command run leaves one line in `audit.jsonl`, and `art history --json` returns it.

## Decisions

- **One spec for all fourteen** (owner, 2026-11-13).
- **Defaults left out of the manifest** rather than a new compact format: one shape, smaller everywhere. `args` and `flags` always present.
- **`usage` in the brief listing, not a `flags` array:** one string reads like the call an agent is about to type and costs the fewest bytes.
- **Folding at 40 commands:** below it the full brief listing (about 150 bytes a command) stays under 6 KB; above it the topics are the cheaper first step.
- **Keyword search, no model:** deterministic, offline, no dependency (issue #15). No `keywords` field until searches are shown to miss.
- **Every project command run is audited, not only destructive ones:** doctor's health checks need the successes too, and it is local (secrets are not a concern, owner).
- **`history` is a reserved word.** Same cost as `state` and `doctor`, and doctor's shadow check already warns.
- **Detached children are not tracked by Artemis.** Tracking means a registry of pids and stop semantics; the store kit already gives a command a place for its pid, and a stop command is the command's to write.
- **The init pointer also goes into an existing CLAUDE.md:** Claude Code reads CLAUDE.md, not AGENTS.md, unless CLAUDE.md imports it.

## Risks

- **Leaving keys out breaks a reader that indexes them.** Mitigated by optional types and by `args`/`flags` always present; the upgrade note says it.
- **Search misses on wording.** Prefix matching and aliases cover plurals and synonyms someone wrote down; a miss costs one retry or a fallback to `--brief`. The benchmark will measure it.
- **The audit file grows in a busy project.** Rotation at 1 MB with one old file.
- **A detached child leaks** if the command never records its pid. Documented as the command's job.
