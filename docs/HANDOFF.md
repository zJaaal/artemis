# Handoff

State on 2026-11-10. Moved from the scripts repo's README (its "Future: Artemis as its own library" section),
where Artemis lived as `command/` until this repo existed. Paths like `command/`, `lib/` and `data/` below are
the scripts repo's. The TypeScript rewrite and npm plan is now [spec 01](../specs/01-typescript-rewrite.spec.md);
the rest is backlog for later specs.

## What moved and what stayed

Artemis is kept separate from the dotCMS commands so it can move to its own repo later.

**Reusable as is**

-   `command/`: the whole framework. It imports nothing from `lib/`, `commands/` or `data/`.
-   `command/kits/`: opt-in pieces an app imports only if it needs them, still free of dotCMS:
    -   `worktrees.js`: one instance per checkout (which checkout am I in, stable slots, ports
        shifted per slot, colors, an env override, refusing unregistered worktrees). The app
        passes where the registry lives, what counts as a checkout and the base ports
        (`lib/instances.js` is that configuration for dotCMS).
    -   `terminal.js`: terminal tabs as data (`{ id, name, title, color, panes }`, or a `layout`
        tree of nested splits) with a Warp
        adapter. tmux (CLI) or iTerm (AppleScript commands) adapters could follow; neither has a
        Warp-style layout file of its own.
-   Public API: `defineCommand`, `defineTopic`, `CommandError`, `UsageError`, `run` (`command/index.js`).
-   `test/artemis.test.js` and `test/fixtures/`: the framework's tests. They use their own sample
    commands, not the dotCMS ones.
-   `bin/art.js`: the pattern for any CLI built on it: call `run(argv, { bin, commandsDir })` and
    set the exit code.
-   The "Adding a command" section above, as the start of the library docs.

**Stays here (dotCMS-specific)**

-   `commands/`, `lib/`, `data/`: the dotCMS commands, the REST client, saved state.
-   The `step: { order, enabled }` convention lives in `lib/steps.js`, not in Artemis. Artemis only
    passes extra definition fields through untouched; that passthrough is what lets a project
    build conventions like this on top.

**To change when extracting**

-   `prompts` is the only dependency, loaded in `command/context.js` only when a command prompts.
    Make it a dependency (or optional peer) of the library.
-   `run()` defaults `bin` to `"art"` (`command/run.js`); the library should require it or read it
    from the consumer's `package.json`.
-   Pick a published name (`artemis` is likely taken on npm) and ship `command/` as `src/`.

**Plan: TypeScript, tests, npm (to do on the personal account)**

Only Artemis goes public; this repo (the dotCMS commands and the machine setup) stays private
and later depends on the published package instead of `command/`.

1. **New public repo** (e.g. `zJaaal/artemis`) holding only `command/`, its kits and tests. A
   fresh history: nothing from this repo's commits (paths, machine setup) comes along.
2. **Rewrite in strict TypeScript**, ESM only, Node 20+, built with `tsup` (JS plus `.d.ts`).
   Port the 36 existing tests first (Vitest), then rewrite against them so behaviour stays the
   same.
3. **Package** `@zjaaal/artemis` (plain names are taken). Core from the main entry; the kits as
   subpath exports (`@zjaaal/artemis/worktrees`, `/terminal`) so apps that do not need them do
   not load them. `prompts` becomes a dependency.
4. **CI (GitHub Actions)**: on every PR, typecheck, lint, test and build on Node 20 and 22.
5. **Releases**, options to pick from:
    - _Changesets_: each PR adds a change note; CI opens a "version packages" PR and merging
      it publishes with a changelog (common for libraries).
    - _Tag-triggered_: bump the version, push `v1.2.0`, CI tests and publishes.
    - _semantic-release_: version and changelog from conventional commits on every merge.
6. **npm auth**: prefer _trusted publishing_ (npm trusts the GitHub Actions workflow through
   OIDC: no token to store or rotate, and the package gets provenance). The alternative is an
   `NPM_TOKEN` automation token stored as a GitHub secret.
7. **Switch this repo** to the package: replace `command/` imports with `@zjaaal/artemis`,
   delete `command/` and its tests here.

**Plan: a store kit for state (handoff)**

Today every piece of state is read and written ad hoc: `data/instances.json` (written by the
worktrees kit through its `stateFile`), `data/initialized.json` (`lib/marks.js`),
`data/steps.json` (`lib/steps.js`), `data/feature-flags.json` and the generated
`data/compose-*.yml`, all through `lib/store.js` (`readData` / `writeData`) or plain `fs`.

**Race (fixed in the meantime):** every read-modify-write used to race, e.g. two `art dotcms start`
at the same moment could pick the same slot. The worktrees kit now holds a lock file
(`<stateFile>.lock`, taken over from dead processes) around every registry write, and
`lib/marks.js` uses `art`'s `withLock`. The store kit would generalize this into `update(fn)` for
every document.

Build it as an opt-in Artemis kit (`command/kits/store.js`, later `@zjaaal/artemis/store`), not in
the core, and free of dotCMS:

1. **Named documents in a folder the app chooses**: `defineStore({ dir })` then
   `store.doc('instances')`. Artemis holds no data of its own; the app says where it lives.
2. **Atomic writes**: write a temporary file, then rename, so a crash never leaves half-written
   JSON.
3. **`doc.update(fn)` under a lock**: read, change and write as one step while other processes
   wait (generalize `lib/lock.js`'s `withLock`, including taking over locks left by dead
   processes). This is what fixes the slot race.
4. **Versions and migrations**: each document stores a version; the app passes upgrade functions
   (e.g. the `coreDir` -> `root` change in the instance registry, done by hand once).
5. **One clear error** for a corrupt file, with a hint (today copied between `lib/store.js` and
   the worktrees kit).
6. **An in-memory store** with the same API, for tests, so commands that use state can finally be
   tested without touching disk.

Then: the worktrees kit takes a store document instead of `stateFile`; `lib/store.js`,
`lib/marks.js` and `lib/steps.js` move onto it; slot allocation and the other read-modify-writes
use `update`. Add `art state [doc] [--reset]` to show or reset a document. Tests first (a test
that starts two concurrent `ensure` calls and checks they get different slots; see the kit's lock tests).
Keep separate files per document; do not merge them into one or add a database.


**Store kit: next spec (decided 2026-11-10, before replacing `prompts`)**

The owner wants the store kit first, because it is what lets the dotCMS scripts run entirely on Artemis. The spec is
`specs/02-store-kit.spec.md` (to be written with `/spec`; this section is its seed).

How state is handled today in the scripts repo (read-only look, 2026-11-10):

-   `lib/store.js`: `readData(name, fallback)` and `writeData(name, value)` on `data/<name>`. Atomic? No: a plain
    `writeFileSync`. A corrupt file becomes a `CommandError` with a hint (copied into the worktrees kit).
-   `lib/lock.js`: `withLock(name, work, { onWait, pollMs })`, async, machine-wide, used to run builds one at a time
    (concurrent Maven builds race on the shared Node download in `~/.m2`). Held for minutes, polls every 5 s, tells the
    caller who it is waiting for. It treats `EPERM` as dead, which is wrong.
-   `lib/marks.js`: read-modify-write of `initialized.json` under `withLock('initialized', ..., { pollMs: 25 })`.
-   `data/instances.json` (written by the worktrees kit through `stateFile`), `data/steps.json` (`lib/steps.js`) and
    `data/feature-flags.json` (`flags apply` mutates what `readData` returns).

What spec 01 already gives the store kit: the worktrees kit's registry lock is now safe and reusable (the file has its
content from the instant it exists, a stale lock is taken over by one process at a time through a guard and only if it
still holds what was judged stale, an empty or unreadable lock gets a grace period, a lock is released only if it is
still the holder's, and "alive" means the process exists, `EPERM` included). Share that core instead of writing a third
lock. It lives in `src/kits/worktrees/lock.ts` and `src/edges/files.ts` today, and would move to a neutral place.

Decisions the spec has to settle (recommendation first):

1.  **Documents versus build locks.** A document update holds the lock for milliseconds, the build lock for minutes with
    an `onWait` callback. Make documents synchronous and expose the long async named lock separately, both on one
    shared lock core.
2.  **Versions and migrations.** Unversioned files stay plain JSON as version 0; from version 1 on the file is
    `{ "$version": n, "data": ... }`. The app passes upgrade functions. A file newer than the code is an error with a hint.
3.  **`update(fn)`.** `fn` returns the new value; returning `undefined` throws (a forgotten `return`). `doc.locked(fn)`
    is for read-modify-writes that may write nothing.
4.  **Reentrancy.** `write()` inside `update()` must not deadlock; make the lock reentrant within the process (safe
    because the work is synchronous).
5.  **Fallbacks are copies** (`structuredClone`), never the shared default.
6.  **An in-memory store** with the same API, so commands that use state can be tested without disk.
7.  **The worktrees kit** takes a store document instead of `stateFile`, behind a compatibility path (spec 01 keeps
    `stateFile`, and its acceptance criteria say so).
8.  **`art state [doc] [--reset]`**: a kit cannot ship command files today (commands are files in the app's folder), so
    decide whether it is a documented example, a helper that registers it, or out of scope.
9.  **Sequencing.** Spec 02 depends on spec 01 being merged, so cut `spec-02` from `spec-01` until it lands. The
    migration of the scripts repo (`lib/` onto the store, `command/` deleted, `@zjaaal/artemis` as a dependency) is a
    separate spec in that repo, after `0.1.0` is on npm.

**Store kit: findings from a first draft (2026-11-10, not kept)**

-   Today's two lock implementations differ: the scripts repo's `lib/lock.js` treats `EPERM` from
    `process.kill(pid, 0)` as dead (wrong: the process exists but is someone else's); the worktrees kit treats it
    as alive (right). Unify on alive.
-   Both take over a lock whose file is empty or unparseable, but `writeFileSync(..., { flag: 'wx' })` creates
    the file before writing the pid, so a reader can see it empty for a moment and steal a live lock. Treat an
    unreadable lock as "being written" until it is older than a short grace period.
-   `update(fn)` calls `write()`, which also locks: make the store's lock reentrant within the process (safe
    because the work is synchronous), or `write()` inside `update()` deadlocks.
-   A change function that returns `undefined` should throw (a forgotten `return`), not write `undefined` or
    "skip": for read-modify-writes that may write nothing, offer `doc.locked(fn)` instead.
-   Versioning without touching existing files: unversioned documents stay plain JSON (version 0); from version 1
    on, store `{ "$version": n, "data": ... }`; a file newer than the code is an error with a hint.
-   The fallback must be a copy (`structuredClone`): the scripts repo's `flags apply` mutates what `readData`
    returns, which is `DEFAULT_FLAGS` itself when the file is missing.

**Backlog: replace `prompts` (decided 2026-11-10, for a later session)**

Artemis does not need a prompt library to work. `prompts` only powers `ctx.prompt` (it was in `command/context.js`
in the old codebase for exactly that, loaded lazily), so it is the only runtime dependency of the package.

Facts gathered when it was discussed:

-   The old scripts repo uses it in 5 places, with two question types only: 3 `confirm` and 2 `multiselect`.
-   `prompts@2.4.2` was last released in 2021 (0 releases in the last 12 months), has two small dependencies
    (`kleur`, `sisteransi`), no install scripts and no known advisories. The risk is staleness, not a known hole.
-   Alternatives checked on npm: `@clack/prompts` (active, 4 dependencies, Node 20.12 or newer, different question
    API), `@inquirer/prompts` (active, 10 dependencies, but its `engines` need Node `^22.22.2 || ^24.15.0 || >=26`,
    which conflicts with our `>=22`), `enquirer` (stale too), and Node's own `readline/promises` (no dependency).
-   Swapping to another library only trades one dependency for another, and changes the public question format
    (`ctx.prompt` takes `prompts`-style question objects today).

Provenance, checked on npm (2026-11-10, with `npm view` and the registry attestations endpoint): `prompts@2.4.2` has
**no** signed provenance (only the registry signature); `@clack/prompts@1.9.0` and `@inquirer/prompts@8.8.0` both
publish SLSA provenance. Provenance proves where a package was built, not that its code is safe, and none of them was
audited.

Effort per route (the seam is `src/edges/prompts.ts` plus its test, so every route is isolated):

-   `@clack/prompts` behind an adapter: about half a day to a day. `ctx.prompt` keeps accepting `prompts`-style question
    objects and the adapter maps `confirm`, `text`, `select`, `multiselect` onto clack's calls (clack returns a symbol on
    cancel, so the adapter turns it into the existing `Cancelled.` error). Four dependencies, Node 20.12 or newer.
-   Built-in on `readline/promises`, no dependency at all: about one to two days, and the smallest attack surface.
    `multiselect` is the cost: arrow-key checkboxes need raw-mode keypress handling and a fake-terminal test. A numbered
    list ("pick 1 3") is much cheaper and easier to test, with a worse UX.
-   `@inquirer/prompts`: blocked, its `engines` (Node `^22.22.2 || ^24.15.0 || >=26`) conflict with our `>=22` floor
    unless the floor is raised.

The owner has not picked a route yet. Lean: zero dependencies if security matters more than UX polish, clack if the UX
should stay as it is. The store kit goes first (see below); this is next after it.

Direction: make the prompt engine pluggable and ship a built-in one with no dependency.

1.  Keep the `ctx.prompt(questions, { hint })` contract and the question shape for the subset in use:
    `confirm`, `text`, `select`, `multiselect` (`{ type, name, message, choices: [{ title, value }], initial }`).
2.  Build the built-in engine on `readline/promises` plus raw-mode keypress handling for `multiselect`. Keep it in
    `src/edges/` (it is the only code that touches stdin and the terminal) and test it with fake streams.
3.  Let a host plug in another engine (for example `@clack/prompts`) through an option, so richer UIs stay possible
    without Artemis depending on them.
4.  Drop `prompts` and `@types/prompts` (the optional peer dependency goes with them), and update spec, README and
    AGENTS. Behavior that must not change: `--yes` and `--json` never prompt, and a prompt nobody can answer throws
    a `CommandError` with a hint.
5.  The one-file seam today is `src/edges/prompts.ts` (`askQuestions`), and `src/edges/prompts.test.ts` fakes the
    package; both are the starting point.

**Ideas worth building**

-   An MCP adapter: `help --json` already lists every command with its args and flags, which maps directly to
    MCP tools (name, description, input schema), so the same command folder could serve both people and agents.
-   Shell completion generated from the same data.
-   Topic aliases (e.g. `exp` for `experiments`) and per-topic default commands.
-   For agents writing their own tools: `scaffold` and `check` commands, result schemas in the manifest, and
    TypeScript command files.

## Name and metaphor (draft, to polish)

**Artemis**, goddess of the hunt: the framework hunts down your commands. It walks a folder and
finds every command in it, with no list to keep up to date.

-   **Arrow** = a command: one file, one arrow (`commands/uve/config/set.js`).
-   **Quiver** = a folder: it holds arrows and other quivers (what the code calls a topic).
-   **`art`** = the CLI this repo builds on it.

Tagline ideas: "Drop an arrow in the quiver, get a command." / "Artemis: drop a file, get a
command."

Naming notes:

-   The plain npm names are taken (`artemis`, `art`, `artemis-cli`, `quiver`), so publish as
    `@zjaaal/artemis`; a scoped name cannot clash.
-   "Artemis" is crowded in search: the NASA program, and Apache ActiveMQ Artemis (a Java message
    broker), which matters if it is ever pitched to Java people. A clear tagline carries the
    meaning the name does not.
-   Use the metaphor for branding only: the README intro, the tagline, a logo. The API, help and
    error text keep plain terms (`command`, `topic`, `_topic.js`, "Unknown command"). People
    already know those from other CLIs and frameworks, so they need no translating. Those
    messages are read by someone who is already confused. The metaphor breaks on nesting (a
    quiver does not hold quivers, but topics nest). And agents reading `help --json` understand
    the plain terms without explanation.

