# SPEC 04 — Agent findings: discovery that does not make agents guess, search, long-running children, buried errors, the agent pointer, an authoring nudge, an audit trail and command health

> **Status:** Approved
> **Depends on:** SPEC 03 (merged in `43b8993`)
> **Date:** 2026-11-13 (revised 2026-11-13 after a clarity review)
> **Source:** issue #15 (fixes 1 to 14), from two internal benchmarks of headless Claude Code on a synthetic project
> **Release:** `1.2.0` (the shape of `help --json` changes; Artemis has no outside users yet, the same reasoning as 1.1.0)

## Why this spec exists

Two benchmarks (about 1,700 agent runs, Haiku and Sonnet, every result checked by code) measured what Artemis does for an agent. What held up:

- Commands an agent writes with Artemis keep the safety parts that its bash scripts drop (refusing a destructive run without confirmation 20/20 against 6/20, a dry run that changes nothing 20/20 against 10/20, `--help` 49/49 against 3/49).
- A destructive marker in the manifest is followed more consistently than the same rule in a doc (a preview before a database reset 5/5 against 2/5).
- A command saves money only when it replaces several steps (about −30 to −50% per repetition on multi-step jobs, nothing on one-call jobs), and a command shaped to the agent's question beats a general one (a self-written `build diagnose` at one call against five).

What cost Artemis its share, against plain scripts, is **discovery**: guessing flags the brief listing does not show, usage errors that say what is wrong but not what is right, a heavy single-command entry, and `help --agents` printing all of AGENTS.md (about 15 KB: 5.4 KB on writing commands, 3.5 KB on calling them, 5.9 KB on running the CLI) when a calling agent needs 3.5 KB. Each fix below is from issue #15, which has the evidence for it. The owner chose (2026-11-13) to do all fourteen in one spec, then run the benchmarks again.

Earlier owner decisions that bound this spec: no permission hooks and no destructive levels ("destructive is destructive"), secrets in arguments are not a concern (everything is local), Node only, and no `tags` field for search.

## Scope

**In:**

1. The brief listing shows how to call each command, flags included.
2. A usage error carries a hint with what is valid.
3. Manifest entries drop keys that hold their default.
4. `help --agents` prints only the calling contract; `help --authoring` prints the writing and setup parts.
5. The brief listing is measured, and keys that repeat are stated once.
6. `ctx.exec(..., { detached: true, logFile })` starts a child meant to outlive the command.
7. `ctx.exec(..., { errorPattern })` keeps the matching lines of a failed child next to its `tail`.
8. Above a number of commands, the top brief listing shows topics, not commands.
9. A size budget for what agents load up front (`help --agents`, the generated skill, the init pointer).
10. `help --search <words>`: the best few commands for an intent.
11. `art init` writes the agent pointer and ignores the audit files in git.
12. The generated skill gains a short "write a command" section.
13. An audit trail, `<stateDir>/audit.jsonl`, and the built-in word `art history`.
14. `art doctor` reports command health from the audit trail.

**Out:** an MCP adapter (#7), shell completion (#8), a `keywords` field, a `valueName` for flags, embeddings or any model for search, running commands from doctor (the issue's "next steps"), auditing for published tools (`cli({ root })`) and `run()` callers that do not ask for it, the benchmark changes (they live outside the repo).

## Data model

### The `usage` string (fixes 1, 2, 3)

One `usage` string per project command, the same everywhere it appears: the full manifest, the brief listing, search results, the usage hint and `UsageError.usage`. Built-in words keep their own fixed usage lines (`STATE_USAGE_LINE` and the others), and `history` gets one written the same way: `history [command words]... [--limit <n>] [--json] [--quiet]`.

- It is the id, then each arg, then each command flag, separated by spaces. **No bin** and no `[flags]` placeholder. Text help and every text line that shows a usage print the bin in front (`Usage  art db prune [target] [--older-than <value>] [--all]`); JSON never does.
- An arg: `<name>` when required, `[name]` when optional. An arg with choices drops its name: `<a|b>` when required, `[a|b]` when optional.
- A flag, in definition order: `[--name]` for a boolean, `[--name <value>]` for a string, `[--name <a|b>]` for a string with choices, and `...` after the closing bracket when `multiple` (`[--tag <value>]...`). A flag's `short` is not shown.
- Global flags are never in `usage`.

Example: `db prune [target] [--older-than <value>] [--all]`.

### Brief entry (fixes 1, 5)

```jsonc
{ "id": "db prune", "description": "Delete old builds", "usage": "db prune [target] [--older-than <value>] [--all]",
  "destructive": true, "dryRun": true }
```

`usage` is new. `destructive` and `dryRun` stay as in spec 03: present only when `true`.

### Brief listing (fixes 5, 8)

```jsonc
{ "bin": "art",
  "topics": [{ "id": "db", "description": "The local database", "commands": 4 }],
  "commands": [ /* brief entries */ ],
  "builtins": ["init", "state", "skill", "doctor", "history"],
  "globalFlags": "--help --json --yes --dry-run --quiet --log <file>",
  "more": "art help <command> --json",
  "search": "art help --search <words> --json" }
```

- A topic always has `commands`: the number of commands under it, nested topics included. A topic with no description has no `description` key.
- `builtins` becomes a list of ids, present only for the shipped `art` (as today). Their descriptions stay in the full `help --json`.
- `globalFlags` is new: the long names of `GLOBAL_FLAGS` in their declared order, `<file>` after `--log`, derived from the constant (not written by hand).
- `search` is always present.
- **Not folded** (as today, plus the fields above): `topics` lists every topic at every depth, and `commands` every command.
- **Folded:** when the project has more than `BRIEF_FOLD_THRESHOLD` (40) commands, the top-level listing has only the top-level topics in `topics`, only the commands that sit in no topic in `commands`, and `more` becomes `"art help <topic> --json --brief"`. A topic's count still includes its nested topics.
- **A topic listing** (`help <topic> --json --brief`) is never folded: its **direct** sub-topics in `topics` (with counts), which is a change (today it lists topics at every depth), and every command under it, at every depth, in `commands`. The difference from the unfolded top level (every topic at every depth) is on purpose: a topic listing is a step down, so its sub-topics are the next step.
- A topic with no command anywhere under it (count 0) is left out of every listing, as today.
- Text `help --brief` folds the same way: a `Topics` section, one line per topic with its count and description, then the commands outside topics, then the `more` line.

### Full manifest entry (fix 3)

A key whose value is its default is left out: `aliases` when empty, `examples` when empty, `destructive` and `dryRun` when `false`; on an arg, `required` when `false`, `default` and `choices` when `null`; on a flag, `short`, `default` and `choices` when `null`, `multiple` when `false`. `id`, `description` and `usage` are always there, and so are `args` and `flags` (possibly empty), so a caller can tell "no flags" from an old Artemis. The types in `models.ts` mark the left-out keys optional, and every reader inside Artemis (text help, `art skill`, doctor, search, brief) treats a missing key as its default. This applies to every `help --json` level and to `art <word> --help --json`.

### Usage hints (fix 2)

```jsonc
{ "ok": false, "command": "db prune", "error": "Unknown option '--days'",
  "hint": "db prune [target] [--older-than <value>] [--all]. Global: --help --json --yes --dry-run --quiet --log <file>" }
```

- **Which errors:** a `UsageError` gains an option `fromCommand: true`, set only by `parse()` when it parses a resolved project command's argv (unknown flag, missing or extra argument, a bad choice, a flag missing its value). For those, when the error has no hint of its own, the hint is `<usage>. Global: <globalFlags>`. It is built in one place, where the error is reported (`report`), from the error's `usage`. Errors without `fromCommand` (built-in words, help, the leading-flag split) are unchanged.
- **An error with its own hint keeps it** (for example `--dry-run` on a command without `dryRun`) and keeps today's `Usage` line in text.
- **Text mode:** when the usage hint is used, it is printed as `Hint` and the separate `Usage` line is not printed (the hint already has the usage in it). `ReportContext` gains an optional `bin`, and `toText` puts it in front of any usage it prints when it is set. Only `run()`'s reporting sets it, so a project command's usage (with or without its own hint) prints `Usage  art <usage>`, while built-in words, reported through `reportSetupFailure` without a bin, keep printing `Usage  state ...` as today. A test covers both. `UsageErrorShape` gains the optional `fromCommand`, and an error from an older copy of Artemis (no marker) just gets no usage hint.
- **`ctx.invoke`:** a nested usage error stays what it is today (a `CommandError`, exit 1, hint `Usage: <bin> <usage>`), with the new `usage` string and without the global flags.
- **Unknown command:** `Did you mean "x"?` when the current edit-distance suggestion finds one (unchanged). Otherwise, the ids that share a word with the last word typed, the one that was not found (words split as in search, equal words only; the topic before it is right, and would share a word with every command in it), the first `UNKNOWN_COMMAND_MAX_IDS` (3) by id order, as `Did you mean one of: "a", "b"?`. Otherwise `Run "art help --json --brief" to see the commands.` (inside a topic, `Run "art help <topic> --json --brief"`), which replaces today's `Run "art <topic> help"` text.

### Search (fix 10)

```jsonc
{ "ok": true, "command": "help",
  "result": { "query": "delete old build artifacts", "matches": [ /* brief entries, best first */ ], "more": "art help <command> --json" } }
```

- **Parsing:** `--search` takes the next token as its value, whatever it starts with, and `--search=<words>` works too. That value is never a topic word. The one exception is a next token that is exactly a global flag (`--json`, `--quiet`, `--dry-run`, `--log`, `--yes`, `--help`, `-h`, `-y`): it stays that flag, the same rule as `--log --json` in spec 03, and the search has no value. A missing value is a usage error (exit 2). Tests cover `help --search --json` and `help --search --dry-run`.
- **`result.query`** is the value as typed.
- **Words:** text is lowercased and split on anything that is not a Unicode letter or digit (`[^\p{L}\p{N}]+`). Words of 1 character are dropped, and so are the words of `SEARCH_STOP_WORDS` (the, and, for, with, from, into, of, to, in, on, an).
- **Empty query:** a query with no word left is a usage error, hint `Search with words from what the command does, for example: art help --search "reset database" --json`.
- **Match:** a query word matches a command word when they are equal, or when the shorter has at least `SEARCH_PREFIX_MIN` (4) characters and is a prefix of the longer (`build` matches `builds`).
- **Text of a command:** its id, aliases, description, examples, its args' and flags' names and descriptions, and the descriptions of every topic above it.
- **Score:** the number of distinct query words that match any word of that text, plus `SEARCH_ID_BONUS` (1) once when at least one query word matches a word of the id. Commands scoring 0 are left out. Ties go by id. At most `SEARCH_MAX_MATCHES` (5). Matching goes through an index (word → commands), not a loop in a loop.
- **No match:** `ok: true`, `matches: []`, exit 0. Text: `No command matches. Run art help --brief.`
- **Text output:** the matches as `help --brief` prints commands, best first, then the `more` line.
- **Scope:** `help <topic> --search <words>` searches inside the topic. `help <command> --search` and `help <builtin> --search` are usage errors. Builtins are never searched.
- **Clashes:** `--search` with `--brief`, `--agents` or `--authoring` is a usage error. `--search` is a flag of `help`, never a reserved word.

### Exec options (fixes 6, 7)

```ts
type ExecOptions = {
    // ...the spec 03 options
    errorPattern?: RegExp; // a failed child keeps the lines matching it
};
type ExecDetachedOptions = { cwd?: string; env?: NodeJS.ProcessEnv; detached: true; logFile: string };
type ExecDetachedResult = { pid: number | null; skipped: boolean };
// ctx.exec(command, args, options: ExecDetachedOptions): Promise<ExecDetachedResult>  (an overload)
```

**`detached: true`**

- **Typing:** it is a separate overload with its own options and result, so `ExecResult` does not change. A type test covers it.
- **Starting it:** the child is spawned in its own process group (`detached: true`, `windowsHide: true`), with `stdin` ignored and stdout and stderr appended to `logFile`. `logFile` is resolved against the child's resolved `cwd`, and its folders are created. The edge opens the file, hands the descriptor to the child, closes it in the parent and `unref`s the child.
- **When it resolves:** once the child has spawned (the `spawn` event), to `{ pid, skipped: false }`. A spawn error (`error` event) rejects with a `CommandError`, as today. It is never killed when `run` ends and never awaited after that.
- **Tracking:** Artemis does not track the child. The command records the `pid` (the store kit is the place) and offers its own stop command.
- **Bad options:** an empty `logFile`, any option not in `ExecDetachedOptions` (`capture`, `readOnly`, `timeoutMs`, `reject`, `errorPattern`), or `logFile` on a call whose `detached` is not `true`, rejects with a `TypeError`. This is checked before the `--dry-run` skip, so a dry run finds the bug too.
- **Failures:** a `cwd` that cannot be used fails first (the log's folders are created only under a usable `cwd`), the same way for a detached call and for a call that waits: one that does not exist is today's "The folder X does not exist" error; one that is a file, or sits under a file, is "X is not a folder" with the hint "Pass a folder as cwd."; one this user cannot enter (no execute permission on it or on a parent) is "This user cannot enter the folder X" with the hint "Check the folder's permissions, or pass another cwd.". A `logFile` that cannot be opened or created (permission, a folder) fails with a `CommandError` naming the file, with the hint `LOG_FILE_HINT`.
- **Under `--dry-run`:** it is planned (`start <command> <args> in the background, output in <logFile>`) and resolves to `{ pid: null, skipped: true }`.
- **Output:** a detached child's output goes only to its `logFile`, never to the terminal, `--log` or `tail`.

**`errorPattern`**

- **Piping:** a call that would inherit the terminal (`pickExecMode` today gives no pipe) becomes `{ pipe: true, echo: 'split', keep: true }`: the child's output is read line by line and still shown (stdout to stdout, stderr to stderr). This loses a terminal child's colors and progress bars, which the docs say. In every other mode (`quiet`, `capture`, `json`, `log`) the echo does not change, and `keep` becomes `true`.
- **What it matches:** the same cleaned lines `tail` sees (CR handled, blank lines dropped), before the per-line cut, from stdout and stderr both.
- **What is kept:** the first `EXEC_ERROR_LINES` (20) matches, each cut to `EXEC_TAIL_LINE_CHARS`.
- **On a failure** (non-zero exit with `reject: true`, or a timeout), they go into the `CommandError` as `errorLines`. In the envelope they go out as `errorLines` right after `tail`, and before `checks`. In text they print under the same condition as `tail`, before it, under the heading `Error lines`.
- **With `reject: false`:** a non-zero exit returns `{ code, output, skipped, errorLines }`, so `ExecResult` gains an optional `errorLines`.
- **No match:** when nothing matches, the key is left out.
- **Bad pattern:** a `RegExp` with the `g` or `y` flag rejects with a `TypeError`, because those make `test` stateful.

### Audit line (fix 13)

```jsonc
{ "time": "2026-11-13T10:02:11.391Z", "command": "db reset", "argv": [], "ran": true, "dryRun": false, "yes": true,
  "exitCode": 0, "ms": 1840, "plan": ["delete .data/db.json"], "error": "..." }
```

- **Where:** only the shipped `art` writes it, to `<stateDir>/audit.jsonl` (the folder is created). `run()` writes only when given `auditFile` (an absolute path), and the shipped route passes it. A published tool (`cli({ root })`) does not audit, because its state folder would sit in its own package.
- **Which runs:** one line per run of a resolved project command: success, failure, a usage error, a refused or declined confirmation. `--help` on a command, help itself, topics, built-in words and unknown commands are not recorded. A command run through `ctx.invoke` is not a separate line.
- **Fields:**
  - `time`: when the run started, `now()` as an ISO string.
  - `command`: the resolved id, also when an alias was typed.
  - `argv`: the tokens after the command id, with every global flag and its value removed and `--` kept.
  - `ran`: `true` when the command's `run` started. A usage error, a refused confirmation (no `--yes` with nobody to answer), a declined one and a `--log` file that cannot be opened are all `ran: false`.
  - `dryRun`: `--dry-run` was passed. `yes`: `--yes` was passed.
  - `exitCode`: the exit code `run()` returns (a refused or declined confirmation is `1`).
  - `ms`: `now()` at the end minus `now()` at the start, prompts included. The same injected `now` is used for both.
  - `plan`: only on a dry run.
  - `error`: only on a failure, the error message.
- **When it is written:** last, in `run()`'s `finally`, after the envelope is printed and after the `--log` file is closed. A slow disk never delays the result.
- **Turning it off:** `"artemis": { "audit": false }`. `readConfig` validates `audit` as a boolean like the other keys, and `VALID_SHAPE_HINT` names it.
- **Write failures:** a failed write warns once on stderr (hidden by `--quiet`) and never changes the exit code or the envelope.
- **Rotation:** best effort. Before an append, when the file is larger than `AUDIT_MAX_BYTES` (1 MB), it is renamed to `audit.1.jsonl` (replacing an older one), and a missing file or a lost rename race is not an error.
- **Other readers:** `art state` ignores both files. `art history` and doctor read only `audit.jsonl`.

### `art history` (fix 13)

`art history [<command words>...] [--limit <n>] [--json] [--quiet]`

- **Which runs:** the newest lines first, at most `HISTORY_DEFAULT_LIMIT` (20).
- **Filter:** every argument (and every word after `--`) is joined by spaces into one command id (`art history db reset`). `history` tries to load the commands to resolve an alias to its id. Any failure to load is ignored silently, and then only an exact id matches.
- **`--limit`:** parsed the way `parseStateWords` parses its flags (`--limit 5` or `--limit=5`). A missing value or a value that is not a positive integer is a usage error (exit 2).
- **Text:** one line per run: the time in UTC ISO form (as written), the command, `dry run` / `exit <code>`, and the argv joined.
- **`--json`:** `{ entries, skipped }`, with the audit lines as written. `skipped` is the number of lines that could not be parsed.
- **Nothing to show:** `entries: []`, and in text `Nothing recorded yet.`, whether there is no audit file or no run matches the filter.
- **As a built-in word of the shipped `art`,** like `state`:
  - it is reserved and listed under `builtins`
  - doctor's shadow check covers it
  - `--quiet` is accepted
  - `--dry-run` and `--log` are refused (exit 2)
  - `history --help --json` prints its manifest entry

### Doctor health checks (fix 14)

Doctor loads the commands (it already does) and reads `audit.jsonl`. A **real run** is a line with `ran: true` and `dryRun: false`. Only real runs count toward "failing", so usage errors, refused confirmations and dry runs never make a command look broken or break a failing streak. Commands in the history that no longer exist produce nothing. Every check uses an injected `now`.

Each kind is **one check**, whatever the number of commands: its message names every command it applies to, and its `fix` names each one. `DoctorCheckId` gains the four ids below, and `DOCTOR_ID_WIDTH` grows to fit the longest.

| Check id | Status | When | Message and `fix` |
| --- | --- | --- | --- |
| `history` | `ok` | no audit file | "no history yet" |
| `history` | `ok` | there is history and none of the checks below apply | "no problems in the last <n> runs" |
| `history-failing` | `warn` | some command's last `HEALTH_FAILING_RUNS` (3) real runs all have a non-zero `exitCode` | names them; fix: `Run art history <id> to see the errors.` for each |
| `history-previewed` | `warn` | some `destructive` command has at least `HEALTH_PREVIEW_RUNS` (3) dry runs (`ran: true`, `dryRun: true`) and no real run | "only ever previewed", names them; fix: `Run it with --yes when the plan looks right, or delete it if it is not needed.` |
| `history-stale` | `warn` | some command with history has its newest line older than `HEALTH_STALE_DAYS` (60) | names them; fix: `Delete the file if the command is no longer used.` |

- A command with no lines gets no check.
- The "no real run" rule only sees the retained file.
- Doctor never runs a command, and none of these checks fails doctor.

### `help --agents` and `help --authoring` (fixes 4, 9)

- **`help --agents`** prints the `## Calling a command` section of the shipped AGENTS.md, then one line: `To write a command or set up a project: art help --authoring`. It must stay under `AGENTS_DOC_MAX_BYTES` (5 KB), and a test reads the shipped file to check it.
- **`help --authoring`** prints the `## Adding a command` and `## Running the CLI` sections. Running the CLI covers setup and the built-in words, `history` included.
- **Headings:** sections are found by exact heading constants, matched from the heading to the next `## `. A missing heading is a bug, and a test reads the shipped file.
- **`--json`:** `{ file, markdown }`, as `--agents` gives today.
- **Usage errors:** `--agents` with `--authoring`, either one with a topic or command word, and either one with `--brief` or `--search`.
- **Pointers:** the README, AGENTS.md, the generated skill and the init pointer send calling agents to `help --json --brief`, and send authors to `help --authoring`.

### Generated skill (fixes 9, 12)

`art skill` keeps its calling part. Its line `To add a command: <bin> help --agents` (`src/cli/skill.ts`) is replaced by this section, written with the project's `bin` and its commands folder relative to the project:

> **Write a command when you do the same job twice.** If you ran the same steps twice in a session, put them in `<commandsDir>/<topic>/<name>.js` and call that instead. `<bin> help --authoring` has the rules: a one-line `description`, `args` and `flags` with descriptions, `destructive: true` for anything that deletes, `dryRun: true` with `ctx.plan` and `ctx.dryRun`, `ctx.exec` for child processes, and `CommandError(message, { hint })` for a failure the caller can fix. Make the result answer the question you ran it for, not a log.

- **Size:** the section is the heading `## Writing a command` and the paragraph above, at most `SKILL_AUTHORING_MAX_BYTES` (900 bytes) once rendered with the default `bin` and `commandsDir` (a test checks that case; a longer `bin` or folder is not cut).
- **Destructive list:** it is capped at `SKILL_MAX_DESTRUCTIVE` (20) entries plus an `and <n> more: <bin> help --json --brief` line, so the skill's size has a ceiling.
- **Test:** the whole generated skill for the `src/test/fixtures` project stays under `SKILL_MAX_BYTES` (4 KB).

### Init pointer and gitignore (fixes 9, 11)

```md
## Commands

This project's commands run through `<bin>`. Start with `npx <bin> help --json --brief`, call one with `--json`, and pass `--dry-run` before `--yes` on a destructive one. To write a new one: `npx <bin> help --authoring`.
```

- **Size:** `<bin>` is the project's `bin` setting, default `art`. With the default, the pointer stays under `INIT_POINTER_MAX_BYTES` (400); a test checks that case, and a longer `bin` is not cut.
- **One decision per file:**
  - `AGENTS.md`: append the pointer, unless the file already contains `help --json --brief`.
  - `CLAUDE.md`, when it exists: append the pointer, unless it has a line matching `^@AGENTS\.md\b` (it imports AGENTS.md) or already contains `help --json --brief`.
- **Creating `AGENTS.md`:** it is created (starting with `# AGENTS.md`, a blank line, then the pointer) when it does not exist and either no `CLAUDE.md` exists or `CLAUDE.md` imports it.
- **Symlinks:** both paths go through `realpath` first, and one real file is written once.
- **Appending:**
  - it never rewrites a line
  - it adds a newline first when the file does not end with one, then one blank line, then the pointer
  - it uses the file's line ending (CRLF when the file's first line ends with one)
- **Gitignore:** `art init` appends `/<stateDir>/audit*.jsonl` to the `.gitignore` in the project folder (next to its `package.json`), under the same append rules: create it when missing, skip it when a line equal to it is there (compared without a trailing CR or spaces). `<stateDir>` is written relative to the project folder with forward slashes (`/data/state/audit*.jsonl`). When `stateDir` resolves outside the project folder, nothing is written. Whether the folder is a git repository does not matter.
- **Result:** `InitResult` gains `changed`, the files appended to. `created` stays the files made new. A rerun with nothing to do is still "Already a project".

## Behavior

- **Order of a usage error:** the parse fails, the error is reported with its usage hint, exit 2, then the audit line is written.
- **Search and folding never change exit codes.** Search is help: exit 0 unless the command line is wrong.
- **Edges:** the audit append, the rotation and the clock are edges (`src/edges/`), injected through `run()`'s options (`auditFile`, `now`) and faked in tests, per CODE_STANDARDS section 7. So are the detached spawn and the init file writes.
- **Constants:** every number named in this spec is a constant in the `constants.ts` of its section.

## Implementation plan

Branch `spec-04`, cut from `housekeeping` (PR #14), which is cut from `main` after spec 03 (`43b8993`). Every step leaves `pnpm run test:all` green, and each is one commit.

1. **Spec.** This file.
2. **Manifest defaults (3).** Types optional, builders leave defaults out, every reader treats a missing key as its default. Tests: an entry with every default has only `id`, `description`, `usage`, `args`, `flags`; each key appears when set.
3. **One `usage` string (1).** The new format everywhere: manifest, text help with the bin in front, `UsageError.usage`, `ctx.invoke` errors. Tests for each arg and flag shape (required, optional, choices on both, boolean, string, multiple).
4. **Brief listing (1, 5).** `usage` per entry, `commands` count per topic, no empty topic `description`, `globalFlags`, `builtins` as ids, `search`. A size test on the `src/test/fixtures` tree with a byte limit; the commit message records the bytes before and after.
5. **Usage hints (2).** Tests: each usage-error kind has the hint; an error with its own hint keeps it and its Usage line; built-in words unchanged; the three unknown-command cases, top level and in a topic; text mode prints the hint instead of Usage.
6. **Folding (8).** A fixture of 200 commands in 10 topics, built in the test, not committed as files. Tests: 40 not folded, 41 folded; top-level topics only, with counts that include nested ones; a topic listing with sub-topic counts; text folding. The folded top-level listing of the 200-command fixture stays under `BRIEF_FOLDED_MAX_BYTES` (6 KB).
7. **Search (10).** Pure scoring in `src/help/search.ts`. Tests per rule: 1-character and stop words, Unicode, prefixes and the minimum length, the id bonus once, topic descriptions, ties, the limit, topic scope, no match, an empty query, `--search=`, a value starting with `-`, and every clash.
8. **`--agents` and `--authoring` (4, 9).** Tests read the shipped AGENTS.md: each prints its sections only, `--agents` stays under its limit, the JSON shape, and every clash.
9. **Exec `detached` (6).** Tests: resolves with a pid after spawn, while the child keeps running; the log file gets its output; `run` ending does not kill it (the test kills it); a spawn error; each `TypeError`, including under `--dry-run`; the dry-run plan; the type overload. A `check-bin` case starts a detached child through the packed `art` and finds it alive after `art` exits.
10. **Exec `errorPattern` (7).** Tests: a match at line 1,800 of 2,000 is in `errorLines`; only 20 are kept; the key is absent on success and when nothing matches; it works with `reject: false`; a `g` flag is rejected; the envelope order; the text printing; a terminal-mode call becomes piped.
11. **Audit and `art history` (13).** Tests:
    - each field, an alias recorded as the id, a usage error recorded with `ran: false`
    - `--help`, help, built-in words and unknown commands not recorded
    - `audit: false`, and `audit` validated
    - rotation at the limit
    - a failed write warns and keeps the exit code
    - `cli({ root })` writes nothing
    - `history` with several words, aliases, `--limit` validation, bad lines skipped, and its reserved-word rules
12. **Doctor health (14).** Tests: each check from a written audit file with an injected `now`; `ran: false` lines ignored; gone commands; no file; all healthy.
13. **Skill and init (9, 11, 12).** Tests: the authoring section with a custom `bin` and `commandsDir`; the size limits; the destructive cap; every init case:
    - neither file
    - `AGENTS.md` only
    - `CLAUDE.md` with and without the import
    - `CLAUDE.md` importing a missing `AGENTS.md`
    - a symlink
    - the pointer already there
    - CRLF
    - no final newline
    - `.gitignore`
    - running it twice
14. **Docs and version.** AGENTS.md (the calling section gains `usage`, `--search`, `errorLines`, `history`; it is measured against its limit), docs/cli.md, docs/commands.md (the exec options, and that `errorPattern` pipes), the README (the agents line near the top and "For agents", which say `help --agents` prints the whole file), docs/upgrading.md ("to 1.2": manifest keys left out, the `usage` format, `history` reserved, the audit file). Set the version to `1.2.0` in a PR labelled `release`.

## Acceptance criteria

- `pnpm run test:all`, `build`, `check-exports`, `check-bin` and `check-lock` pass.
- `db prune --days 30`, on a `db prune` command a test adds with the flags of the example above, fails (exit 2) with a hint showing `--older-than`, and `help --json --brief` shows `--older-than` without another call.
- The folded brief listing of a 200-command project is under 6 KB, and `help --search` returns at most 5 entries whatever the project size.
- `help --agents` is under 5 KB.
- A detached child started by a command through the packed `art` is still running after `art` exits.
- A failed child whose only error line is far above the tail returns that line in `errorLines`.
- With the shipped `art` and auditing on, every run of a project command except `--help` leaves one line in `audit.jsonl`, and `art history --json` returns it.

## Decisions

- **One spec for all fourteen** (owner, 2026-11-13).
- **Defaults left out of the manifest** rather than a new compact format: one shape, smaller everywhere. `args` and `flags` always present.
- **One `usage` string, flags spelled out, no bin:** it reads like the call an agent is about to type, and costs fewer bytes than a `flags` array. Flags show `<value>`. A `valueName` field could show `<days>` later, but it is a new public field, so it is out.
- **Folding at 40 commands:** with `usage` an entry is about 220 bytes, so the full brief listing tops out near 9 KB, about one `help --agents` read today. Above it, topics are the cheaper first step. The benchmark world (21 commands, about 4.6 KB) stays unfolded.
- **Keyword search, no model:** deterministic, offline, no dependency (issue #15). There is no `keywords` field until searches are shown to miss. Words of 2 characters are kept, because topics like `db` and `ci` are common.
- **Every project command run is audited, not only destructive ones** (2026-11-13): doctor's health checks need the successes too. It is local, and secrets are not a concern (owner).
- **Audit on the shipped route only:** a published tool's state folder is inside its own package, and only `art history` reads the file.
- **`history` is a reserved word.** It costs the same as `state` and `doctor`, and doctor's shadow check already warns.
- **Detached children are not tracked by Artemis.** Tracking means a registry of pids and stop semantics. The store kit already gives a command a place for its pid, and a stop command is the command's to write.
- **The init pointer also goes into an existing CLAUDE.md** (2026-11-13): Claude Code reads CLAUDE.md, not AGENTS.md, unless CLAUDE.md imports it.
- **"Running the CLI" moves behind `--authoring`:** setting a project up is the author's job, and a calling agent needs only the contract.

## Risks

- **Leaving keys out breaks a reader that indexes them.** Mitigated by optional types and by `args`/`flags` always present. The upgrade note says it.
- **Search misses on wording.** Prefix matching and aliases cover plurals and synonyms someone wrote down. A miss costs one retry or a fallback to `--brief`. The benchmark will measure it.
- **The audit file grows in a busy project.** Rotation at 1 MB with one old file. Rotation is best effort under concurrent runs.
- **A detached child leaks** if the command never records its pid. The docs say that is the command's job.
- **`errorPattern` changes how a terminal child looks** (piped, no colors). The docs say so.
