# SPEC 02 — Store kit, `art state`, and `prompts` replaced by `@topcli/prompts`

> **Status:** Approved **Depends on:** SPEC 01
> **Date:** 2026-11-11
> **Objective:** Add a store kit that gives apps safe, versioned JSON documents and a built-in `art state` to inspect and reset them, and replace the `prompts` dependency with `@topcli/prompts` behind a typed `ctx.prompt`, which together make Artemis `1.0.0`.

## Why this spec exists

Spec 01 left two things in `0.x` on purpose, and `docs/HANDOFF.md` names them as what stands between Artemis and a stable API: the store kit (so the worktrees kit stops owning a private JSON file through `stateFile`) and the removal of `prompts` (so `ctx.prompt` stops promising a third-party question format). This spec does both. They are one spec because they are one release: `1.0.0` breaks `ctx.prompt` and `stateFile` once, not twice.

### State: what an app does today, and what goes wrong

The scripts repo (the dotCMS commands, the first real user of Artemis) keeps all its state as JSON files in `data/`, read and written ad hoc:

- `lib/store.js`: `readData(name, fallback)` and `writeData(name, value)` on `data/<name>`. `writeData` is a plain `writeFileSync`, so a crash mid-write leaves half a file. A corrupt file becomes a `CommandError` with a hint, and the same check is copied into the worktrees kit (`src/kits/worktrees/registry-store.ts`).
- `lib/lock.js`: `withLock(name, work, { onWait, pollMs })`, async, used to run Maven builds one at a time. It is held for minutes, polls every 5 s and tells the caller who it waits for. It treats `EPERM` from `process.kill(pid, 0)` as "dead", which is wrong (the process exists, it is someone else's), and it creates the lock file before writing the pid into it, so a reader can see it empty and steal a live lock.
- `lib/marks.js`: a read-modify-write of `initialized.json` under `withLock('initialized', ..., { pollMs: 25 })`, because "several instances finish starting at once (one steps pane each): read, change and write the file under a lock, or one write can drop another's mark".
- `lib/steps.js` and `commands/flags/apply.js`: plain `readData` / `writeData`. `flags apply` mutates what `readData` returns, and when `data/feature-flags.json` does not exist yet that is `DEFAULT_FLAGS` itself, so the "defaults" change for the rest of the run.
- `data/instances.json`: written by the worktrees kit through `stateFile`, with its own lock (`src/kits/worktrees/lock.ts`), which spec 01 already made safe (content before the file appears, guarded takeover, grace period, release only if still ours, `EPERM` is alive).

So the same three problems (non-atomic writes, racing read-modify-writes, copied corrupt-file errors) are solved once in the worktrees kit and badly or not at all everywhere else. The store kit is that one solution, made generic: **Artemis models nobody's state.** The app picks the folder, the document names, their shape and their defaults. The kit only guarantees how a file is read and written. `steps.json` and `feature-flags.json` stay dotCMS files; they are the use case, not part of Artemis. Moving the scripts repo onto the kit is its own spec in that repo.

### `art state`: why a built-in word

An agent that runs a command which keeps state cannot see that state, and when it is wrong the only fix today is "delete `data/x.json`", which an agent has to discover by reading code. The owner wants that to be part of the CLI: `art state` lists the documents, `art state <doc>` shows one, `art state <doc> --reset` deletes it so the app falls back to its defaults. A kit cannot ship command files (a command is a file in the app's own `commands/` folder), so `state` is a fixed word of the shipped binary, like `init`.

That raises the one real design problem of this spec: the shipped `art` never loads app code, and the store folder is chosen in app code. So the folder has to be declared where both can read it: `"artemis": { "stateDir" }` in the project's `package.json`, which `art state` reads and which `defineStore({ project: import.meta.url })` resolves the same way. One declaration, so the app and the CLI cannot disagree.

### Prompts: why `@topcli/prompts`

`prompts@2.4.2` is the only runtime dependency. It was last released in 2021, has two dependencies (`kleur`, `sisteransi`) and **no** provenance. Nothing is known to be wrong with it; the risk is that nobody is watching. The owner asked for a lighter and more secure library. Checked on npm on 2026-11-11 (`npm view`, the npm downloads API, the GitHub advisory database, and a real pseudo-terminal for Ctrl+C):

| Package | Runtime deps (transitive) | `engines.node` | Provenance | Last release | Downloads/week | Ctrl+C in a real pty |
| --- | --- | --- | --- | --- | --- | --- |
| `prompts@2.4.2` (today) | 2 | `>= 6` | no | 2021 | 91.6 M | handled |
| **`@topcli/prompts@4.0.0`** | **0** | **`>=22.0.0`** | **yes (SLSA v1)** | 2026-07-05 | 0.65 M | **hangs** unless the host passes an `AbortSignal` (verified: wiring Ctrl+C to an `AbortController` works) |
| `@clack/prompts@1.9.0` | 5 (`@clack/core`, `sisteransi`, `fast-wrap-ansi`, `fast-string-width`, `fast-string-truncated-width`) | `>= 20.12.0` | yes | 2026-11-09 | 43.5 M | returns a cancel symbol |
| `@inquirer/prompts@8.8.0` | ~17 | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` (conflicts with our `>=22`) | yes | 2026-11-10 | 61.9 M | not tested (blocked) |
| `enquirer@2.4.1` | 2 | `>=8.6` | no | 2023 | 48.8 M | not tested (stale) |

No advisories were found for any of them. `@topcli/prompts` is one 41 KB ES module that imports only `node:` built-ins (`events`, `os`, `readline`, `stream`, `util`, `process`). It is published with provenance from GitHub Actions by the NodeSecure maintainers (a supply-chain security project), carries an OpenSSF scorecard, needs exactly our Node floor, has no install scripts, accepts injected `stdin` / `stdout`, and takes an `AbortSignal`. Zero dependencies is the deciding point: the supply chain shrinks to one package, versus five for clack. Its costs, found while checking it, are handled in this spec:

- **Ctrl+C hangs.** It puts stdin in raw mode, so Ctrl+C arrives as a keypress, and it never listens for one. Artemis listens for Ctrl+C itself and aborts the prompt through its `signal` (verified in a pty).
- **Its README documents an `AbortError` export that 4.0.0 does not have** (`export { PromptAgent, confirm, multiselect, question, select, transformers, validators }`). Artemis recognizes the abort by `error.name === 'AbortError'`.
- **A terminal that reports 0 columns** makes it emit `ESC[InfinityA` (seen in a pty with no size set). Real terminals report a width; noted as a risk.
- **Less adoption** than clack. Mitigated by the exact pin, the single seam (`src/edges/prompts.ts`), and the fact that a swap later changes no public type, because `ctx.prompt`'s types are Artemis's own.

`ctx.prompt` also changes shape (owner, 2026-11-11). Today it takes `prompts`-style question objects (`ctx.prompt({ type: 'confirm', name: 'change', message })` and returns `{ change }`), so its types come from `@types/prompts`, an optional peer dependency. It becomes four typed methods that return the answer directly. The scripts repo uses only `confirm` (3 places) and `multiselect` (2 places), so four types cover every real call with room for `text` and `select`.

## Scope

**In:**

- A new kit, `@zjaaal/artemis/store` (`src/kits/store/`): `defineStore({ dir })` or `defineStore({ project })`, named JSON documents (`store.doc(name, { fallback, version, upgrades })`) with `read`, `write`, `update`, `locked` and `reset`, atomic writes, a corrupt-file error with a hint, versions with upgrade functions, an async named lock for long work (`store.lock(name, work, { onWait })`), and `createMemoryStore()` with the same API for tests.
- One lock core shared by documents, named locks and the worktrees kit: the worktrees kit's `lock.ts` and `lock-edges.ts` move into the store kit, generalized from "the instance registry" to any file, made reentrant within a process, and given an async driver.
- The worktrees kit takes `registry: Doc<WorktreeRecords>` instead of `stateFile`. Its private store (`registry-store.ts`) is deleted. The lock options (`now`, `isProcessAlive`, `pause`, `lockTimeoutMs`) move to `defineStore`.
- `"artemis": { "stateDir" }` in the project's `package.json` (default `state`), validated with the other keys.
- `art state [<doc>] [--reset] [--yes] [--json] [--help]`, a fixed word of the shipped binary, like `init`. It is listed in `help` and in `help --json` (shipped route only).
- `ctx.prompt` becomes `{ confirm, text, select, multiselect }`, typed by Artemis, powered by `@topcli/prompts@4.0.0` (exact pin, lazy import), with Ctrl+C wired to an `AbortSignal`.
- `prompts` and `@types/prompts` leave `package.json` (dependency, optional peer and dev dependency).
- README, AGENTS.md and `docs/HANDOFF.md` updated; a README section "Upgrading from 0.1".
- `package.json` version `1.0.0`.

**Out of scope (for future specs):**

- Moving the scripts repo onto the store kit and the new `ctx.prompt` (separate spec in that repo).
- `art state <doc> --set <json>` (writing a document from the command line). Considered and left out by the owner: it writes data the app's code never checked.
- `state` on a published tool's own CLI (`cli({ root })`). Nothing is reserved there, as with `init`.
- Prompt types beyond the four: secret input, validators, autocomplete, editor, number. `@topcli/prompts` supports some of them; Artemis exposes them when a command needs one.
- A pluggable prompt engine (a host passing its own library). `docs/HANDOFF.md` suggested it; one engine behind one edge is enough until someone needs two.
- Non-JSON documents (YAML, the scripts repo's generated `compose-*.yml`). The store holds JSON only.
- A user-level state folder (`~/.artemis`), or where a published tool installed globally should keep state. Such a tool passes `dir` itself.
- Merging documents into one file, a database, or queries.
- Releasing `1.0.0`: the owner tags and approves it, as for every release.

## Data model

Types live in `src/kits/store/models.ts` (kit types) and `src/models.ts` (core types), per CODE_STANDARDS.

```ts
// src/kits/store/models.ts

/** Where a store keeps its documents: a folder, or the project's "artemis".stateDir. */
export type StoreOptions = (
    | { dir: string } // absolute, or relative to the current folder
    | { project: string | URL } // import.meta.url of any file inside the project
) &
    LockOptions;

/** The clock, liveness and waiting of the lock, injectable so tests never sleep. All optional. */
export type LockOptions = {
    now?: NowFn; // default Date.now
    isProcessAlive?: IsProcessAliveFn; // default process.kill(pid, 0), EPERM counts as alive
    pause?: PauseFn; // default a blocking wait (documents are synchronous)
    sleep?: SleepFn; // default timers/promises setTimeout (the async named lock)
    lockTimeoutMs?: number; // documents give up after this long; default 10 s (LOCK_TIMEOUT_MS, as today)
};

export type DocOptions<T> = {
    fallback: T; // what read() returns when the file does not exist; always a copy (structuredClone)
    version?: number; // default 0: the file is plain JSON, as every file is today
    upgrades?: Upgrades; // { 1: (v0) => v1, 2: (v1) => v2 }, keyed by the version each one produces
};
export type Upgrades = Readonly<Record<number, UpgradeFn>>;
export type UpgradeFn = (previous: unknown) => unknown;

export type Doc<T> = {
    readonly name: string; // "instances"
    readonly file: string; // "<dir>/instances.json", absolute
    read: () => T; // no lock; a fresh copy every time; upgrades applied in memory, never written by a read
    write: (value: T) => void; // under the lock, atomic (temp file + rename)
    update: (change: (current: T) => T) => T; // read, change, write as one step under the lock; returns what it wrote
    locked: <R>(work: (doc: Doc<T>) => R) => R; // hold the lock for a read-modify-write that may write nothing; synchronous only (see below)
    reset: () => void; // under the lock, deletes the file without reading it (works on a corrupt or too-new file): the next read returns the fallback
};

export type Store = {
    readonly dir: string;
    doc: <T>(name: string, options: DocOptions<T>) => Doc<T>;
    lock: <R>(name: string, work: () => R | Promise<R>, options?: NamedLockOptions) => Promise<R>;
};
export type NamedLockOptions = {
    onWait?: (holder: LockHolder) => void; // called once, when the lock is first found taken
    pollMs?: number; // default NAMED_LOCK_POLL_MS (1 s)
    timeoutMs?: number; // default: wait as long as it takes (a build may run for minutes)
};
export type LockHolder = { pid: number | undefined }; // undefined while the holder is still writing the file

export type DefineStoreFn = (options: StoreOptions) => Store;
export type CreateMemoryStoreFn = (options?: MemoryStoreOptions) => Store;
export type MemoryStoreOptions = { documents?: Record<string, unknown> }; // initial contents by name, as they would be on disk
```

On disk:

- A document is `<dir>/<name>.json`. A name matches `^[a-z0-9][a-z0-9-]{0,63}$` (`DOC_NAME`, `MAX_DOC_NAME_LENGTH = 64`); anything else is a `TypeError` from `store.doc`, because it is a bug in the app, not a user mistake. `instances`, `steps`, `feature-flags` and `initialized` all fit.
- Version 0 (the default) is the plain JSON value, exactly what is on disk today, so no existing file needs a migration. Version 1 and up is `{ "$version": n, "data": <value> }`. A file whose version is lower than the document's is upgraded in memory, one step at a time, through `upgrades[n]`. A missing step is a `TypeError` when the document is defined, not when it is read. A file whose version is higher than the code's is a `CommandError`: "data/steps.json is version 3, newer than this code (2)", hint "Update the app, or reset it to start again from the defaults." Accepted ambiguity: a version-0 document whose value happens to be an object with a `"$version"` key is read as versioned. A document only gets there by an app writing that key itself.
- JSON is written with 4-space indentation and a trailing newline (`STORE_INDENT_SPACES = 4`), as `lib/store.js` and the worktrees kit write today.
- An atomic write goes to `<file>.<pid>.<token>.tmp` in the same folder, then `rename`s it over the file. The temp file is removed in `finally` when anything fails. `art state` never lists `*.tmp` or `*.lock`.
- A document's lock is `<file>.lock`, holding `<pid> <token>`, exactly the worktrees registry lock of today (`data/instances.json.lock`). A `0.1` and a `1.0` process running at once therefore still exclude each other, **as long as the document's file is the path `0.1` had as `stateFile`**: `store.doc(name)` under the same folder, with `name` equal to the old file name without `.json`. A registry kept under a different name, or a `stateFile` whose name is not a valid document name (`Instances.json`), is a new file to `1.0`. The upgrade note says to keep the name, or to rename the file while nothing runs.
- A named lock is `<dir>/<name>.lock`. The two never collide: a document lock always ends in `.json.lock`, so a named lock `foo` and a document `foo` are different files. `art state` ignores every `*.lock`, so named locks are deliberately invisible to it: a lock is not state, and resetting one by hand is what the locked message's hint ("delete <lock>") is for.
- A corrupt document is one `CommandError`: "<file> is not valid JSON: <reason>", hint "Fix the file, or delete it to start again from the defaults." The hint names no binary (the kit does not know which CLI runs it), the same rule spec 01 set for setup errors.

The lock core (moved from `src/kits/worktrees/lock.ts`):

```ts
// One attempt to take a lock, as data, so a synchronous and an asynchronous driver share it.
export type LockStep = { kind: 'acquired' } | { kind: 'wait'; holder: LockHolder } | { kind: 'retry' };
export type TryLockFn = (attempt: LockAttempt) => LockStep; // create exclusively, or judge the holder: wait, or take over and retry
// Drivers:
//   withLockSync(file, work, edges)          documents: pause between steps, CommandError after lockTimeoutMs, reentrant
//   withLockAsync(file, work, edges, opts)   named locks: sleep between steps, onWait once, timeout only when given
```

- **Reentrant within a process for documents.** A process-wide set of lock files currently held synchronously. When `write()` runs inside `update()` or `locked()`, the lock is already held, so the work runs directly. This is safe because the work is synchronous: nothing else in the process can run in between. Without it, `write()` inside `update()` deadlocks.
- **Document work is synchronous, and that is checked at runtime.** The type `work: (doc) => R` allows an async function, whose promise would escape the lock (it is released when the function returns, before the promise settles), and would leave the reentrancy set lying about what is held. So `locked(work)` and `update(change)` check what they got back: a thenable is a `TypeError` ("locked() work must be synchronous; use store.lock() for async work"). The lock is released and nothing is written. A thenable from `update`'s change is the same error. Long or async work belongs in `store.lock`.
- **Not reentrant for named locks**, because async work interleaves. A process asking for a named lock its own process already holds gets a `CommandError` ("<name> is already held by this process"), never an endless wait.
- Behavior kept from spec 01, by moving the code and its tests: content is written before the file appears, a stale lock is taken over by one process at a time and only if it still holds what was judged stale, an empty or unreadable lock gets `LOCK_GRACE_MS`, a lock is released only if it is still the holder's, and `EPERM` means alive. The message changes from "The instance registry is locked by process N." to "<file> is locked by process N.", and its hint stays "If no other command is running, delete <lock>."

The worktrees kit:

```ts
// src/kits/worktrees/models.ts
export type WorktreesOptions = {
    registry: Doc<WorktreeRecords>; // replaces stateFile: store.doc('instances', { fallback: {} })
    mainCheckout: string;
    ports: Record<string, number>;
    isCheckout?: IsCheckoutFn;
    envVar?: string;
    slotStep?: number;
    colors?: readonly string[];
    mainName?: string;
    env?: NodeJS.ProcessEnv;
    // now, isProcessAlive, pause and lockTimeoutMs are gone: they are StoreOptions now
};
```

`ensure`, `ensureDetached` and `remove` run inside `registry.locked(...)` instead of `withLock(config.stateFile, ...)`. `RegistryStore`, `CreateRegistryStoreFn`, `KitConfig.stateFile` and `KitConfig.lock` are removed.

The core:

```ts
// src/models.ts
export type ArtemisConfig = {
    commandsDir?: string;
    bin?: string;
    stateDir?: string; // relative to the folder of that package.json; default "state". Read by `art state` and defineStore({ project })
};

// ctx.prompt: Artemis's own types. Values are strings because @topcli/prompts returns strings.
export type Prompter = {
    confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
    text: (message: string, options?: TextOptions) => Promise<string>;
    select: <const T extends string>(message: string, options: SelectOptions<T>) => Promise<T>;
    multiselect: <const T extends string>(message: string, options: MultiselectOptions<T>) => Promise<T[]>;
};
export type PromptOptions = { hint?: string }; // the hint of the error thrown when nobody can answer, as today
export type ConfirmOptions = PromptOptions & { initial?: boolean }; // default false
export type TextOptions = PromptOptions & { initial?: string }; // returned when the user just presses Return
export type Choice<T extends string> = { label: string; value: T; description?: string };
export type SelectOptions<T extends string> = PromptOptions & { choices: readonly Choice<T>[] };
export type MultiselectOptions<T extends string> = PromptOptions & {
    choices: readonly (Choice<T> & { selected?: boolean })[];
};
// CommandContext.prompt: PromptFn  becomes  CommandContext.prompt: Prompter.
// PromptFn, PromptResult and AskFn (and the `prompts` import) are removed.
// The edge's type: AskFn = (question: Question, signal: AbortSignal) => Promise<unknown>,
// where Question is a union of { kind: 'confirm' | 'text' | 'select' | 'multiselect', message, options }.
```

With literal choices the answer is narrowed: `ctx.prompt.select('Runner', { choices: [{ label: 'Node', value: 'node' }, { label: 'Deno', value: 'deno' }] })` is `Promise<'node' | 'deno'>`. Choices built at runtime (`steps.map(...)`) widen to `string`.

Behavior that does not change: `--yes` and `--json` never prompt, and **`--yes` does not answer a question with its default**. A `confirm` with `initial: true` still throws under `--yes`. What `--yes` means is the command's decision (it reads `flags.yes` or `ctx.interactive` and skips the question), as `art state --reset --yes` does. The README says so, because users may expect `--yes` to pick the default; a prompt nobody can answer throws `CommandError` "Cannot prompt: ..." (today's `NOT_INTERACTIVE_MESSAGE`) with `options.hint`, or the default "Pass --yes to skip the question."; a cancelled prompt throws `CommandError` "Cancelled." (exit 1). Calling `ctx.prompt(...)` the old way fails with JavaScript's own "ctx.prompt is not a function". The README's "Upgrading from 0.1" section shows the mapping.

`art state` output:

```jsonc
// art state --json  (a document that cannot be read is listed with an error instead of a version, never fails the call)
{ "ok": true, "command": "state", "result": { "dir": "/abs/data", "documents": [
    { "name": "instances", "version": 0, "file": "/abs/data/instances.json" },
    { "name": "steps", "version": null, "file": "/abs/data/steps.json", "error": "/abs/data/steps.json is not valid JSON: Unexpected token" }
] } }
// art state steps --json
{ "ok": true, "command": "state", "result": { "name": "steps", "version": 0, "file": "/abs/data/steps.json", "data": { "...": true } } }
// art state steps --reset --yes --json
{ "ok": true, "command": "state", "result": { "name": "steps", "file": "/abs/data/steps.json", "reset": true } }
```

Paths: under `--json` every path (`dir`, `file`) is absolute, so a caller never has to know the current folder. The text output shows them relative to the current folder, for people to read.

How `art state` touches files, which is not through `Doc`: `art state` has no fallback and no version (both live in app code), so it never calls `store.doc` or `read`. It uses two raw operations of the store kit, exported for it from `src/kits/store/raw.ts` and not from `@zjaaal/artemis/store`:

- `inspectDocument(file)`: reads and parses without a fallback or upgrades, and returns `{ version, data }` or `{ error }`, never throwing for a bad file. It does not know which version the app expects, so it reads the file's shape only. A JSON object with a numeric `"$version"` and a `"data"` key is `{ version: $version, data }`; anything else is `{ version: 0, data: <the whole value> }`. A plain version-0 object that happens to carry those keys is therefore shown as versioned. That is the accepted ambiguity of the version format above, not a separate rule.
- `removeDocument(file, lockOptions)`: deletes the file under its document lock (`<file>.lock`), without reading it. A corrupt document or one newer than the code can therefore always be reset, and resetting is how a user fixes them. `Doc.reset` is built on it too, passing the store's lock options.

Where `art state` gets the lock options, since it has no store: `state-command.ts` takes them as an injectable edge, the way the context takes the prompt edge. Its signature is `StateCommandFn = (words, host, cwd, edges?: StateEdges)`, with `StateEdges = { lock: LockOptions }` (`src/models.ts`). `launch.ts` calls it without `edges`, so the real clock, liveness check and blocking wait from `src/kits/store/lock-edges.ts` apply. Tests that need a held or stale lock (a reset that waits, a reset that times out, a reset that takes over a dead holder's lock) call `stateCommand` directly with fake `now`, `pause` and `isProcessAlive`, and never sleep. The edges are not part of `cli()`'s options: a published tool has no `state`, and the shipped binary needs no injection.

The name on the command line is untrusted. `art state` checks it against `DOC_NAME` before it builds any path. A name that fails (`..`, `../x`, `a/b`, `Foo`, an empty string) is reported exactly like an unknown document: "No document <name> in <dir>", exit 1, with the hint listing the documents that exist. It is never a `TypeError` with a stack trace, and it never reaches a file operation. Only names that pass are joined to `stateDir`.

`help --json` gains a top-level `builtins` array on the shipped route only: `[{ "id": "init", ... }, { "id": "state", ... }]`, each in the same shape as a `commands` entry (`id`, `description`, `usage`, `aliases: []`, `args`, `flags`, `examples`). Every existing field keeps its name and place. A published tool's manifest (`cli({ root })`) has no `builtins` key.

Package layout additions:

```
src/kits/store/        index.ts (re-exports only), models.ts, constants.ts,
                       store.ts (defineStore), doc.ts (read/write/update/locked/reset),
                       raw.ts (inspectDocument, removeDocument: for doc.ts and art state, not exported publicly),
                       versions.ts (pure: wrap, unwrap, upgrade), names.ts (pure),
                       memory.ts (createMemoryStore), lock.ts + lock-edges.ts (moved from worktrees),
                       their tests
src/cli/state.ts       pure: the plan of a state call (list, show, reset) from the words and the files read
src/cli/state-command.ts   `art state`: parses its words, prompts for --reset, prints
src/edges/files.ts     + renameFile, writeExclusive temp, listJsonFiles
src/edges/prompts.ts   @topcli/prompts, lazy, Ctrl+C -> AbortSignal
```

`package.json`: a fifth export `"./store": { "types": "./dist/kits/store/index.d.ts", "import": "./dist/kits/store/index.js" }`; `"dependencies": { "@topcli/prompts": "4.0.0" }`; no `peerDependencies`, no `peerDependenciesMeta`; no `prompts` or `@types/prompts` anywhere; `"version": "1.0.0"`.

## Implementation plan

Branch `spec-02` from `main`. Every step leaves `pnpm run test:all` green.

1. **Spec and handoff.** Commit this spec. In `docs/HANDOFF.md`, replace the sections "Store kit: next spec", "Store kit: findings from a first draft" and "Backlog: replace `prompts`" with one line each pointing at spec 02, and keep the versioning note.
2. **Lock core moves.** Move `src/kits/worktrees/lock.ts`, `lock-edges.ts` and their tests to `src/kits/store/`, with their constants and types. Turn the loop into `tryLock` (one step as data, `LockStep`) plus the synchronous driver `withLockSync`. The worktrees kit imports it from there. Generalize the locked message to name the file. Every moved test passes unchanged apart from the message. `pnpm run check-lock` still passes.
3. **Reentrancy and the async driver.** Add the in-process held set to `withLockSync` (tests: a nested call on the same file runs without waiting; a nested call on another file locks it; the held set is cleared when the work throws). Add `withLockAsync` with `sleep`, `onWait` called once, an optional timeout, and the "already held by this process" error (tests use a fake clock and a fake `sleep`, no real waiting).
4. **File edges.** In `src/edges/files.ts`: `renameFile`, and a helper that writes a temp file next to a target and renames it into place, cleaning up on failure. Add `listJsonFiles(dir)`, which skips `*.tmp` and `*.lock`. Tests in real temp folders: the target is never seen half-written, and a failed write leaves no temp file.
5. **Versions and names (pure).** `versions.ts`: wrap a value for version n, unwrap a parsed file into `{ version, value }`, upgrade from version a to b through `upgrades`, refuse a newer file, check at definition that every step from 1 to n exists. `names.ts`: the `DOC_NAME` check. Tests per case, one case per test.
6. **Documents.** `doc.ts` and `store.ts` with `{ dir }` (relative to the current folder): `read` (fallback as a `structuredClone`, upgrade in memory, corrupt-file error), `write` (atomic, under the lock), `update` (throws `TypeError` "update() must return the new value" when the change returns `undefined`), `locked`, `reset`. `raw.ts` holds `inspectDocument` and `removeDocument` (Data model); `read` and `reset` are built on them. `locked` and `update` throw the synchronous-work `TypeError` when the work or the change returns a thenable, release the lock, and write nothing. Tests cover: a read of a missing file never returns the fallback object itself; mutating a read never changes the next read; `write` inside `update` does not deadlock; two child processes running `update` 50 times each on one counter end at 100 (a real-process test beside `check-lock`, or inside it); a version-0 file written by `0.1` reads unchanged; `reset` deletes a corrupt file and a file newer than the code; `inspectDocument` returns `{ error }` for a corrupt file instead of throwing.
7. **Named lock.** `store.lock(name, work, options)` on `withLockAsync`, released in `finally`. Tests: two overlapping calls run one after the other, `onWait` gets the holder's pid once, a lock left by a dead process is taken over, and asking again for a lock this process already holds fails fast.
8. **Memory store.** `createMemoryStore({ documents })`: the same `Store`, held in a `Map` of JSON strings so copies and corrupt-file behavior match the disk store. Its lock is in-process (documents reentrant; named locks serialize through a promise chain). One shared contract test file runs the same cases against both stores.
9. **`stateDir` and `{ project }`.** Add `stateDir` to `ArtemisConfig` and its validation in `src/cli/settings.ts` (a non-empty string, like the other fields), with the default `"state"` in `src/constants.ts`. `defineStore({ project })` finds the project with spec 01's shipped-route search (`findProject`, the nearest `package.json` with an `"artemis"` key or a `commands/` folder) starting from the folder of that URL, never from the current folder, and resolves `stateDir` from the project root. `findProject` already takes any start folder; its first parameter is named `cwd`, and this step renames it to `start` (in `FindProjectFn` too) so the name stops suggesting otherwise. Not finding one is the usual "No project found" `CommandError`. Tests: `project` and `art state` resolve the same folder from a file in a subfolder; `project` gives the same folder whatever the current folder is (run from an unrelated temp folder); a bad `stateDir` names the field.
10. **Export the kit.** `src/kits/store/index.ts` re-exports `defineStore`, `createMemoryStore` and the public types. Add the `./store` export to `package.json`. `scripts/check-exports.mjs` imports `@zjaaal/artemis/store` and asserts both functions exist.
11. **Worktrees on the store.** Replace `stateFile` and the lock options with `registry: Doc<WorktreeRecords>`. Delete `registry-store.ts` and its test, and run the registry operations inside `registry.locked`. Port every worktrees test to build its registry with `defineStore({ dir: tempDir, ...fakeLockOptions })`. The two concurrent `ensure` calls still get different slots, and a registry file written by `0.1` is read unchanged. Update `scripts/check-lock.mjs` to build the registry through the store.
12. **Typed `ctx.prompt` on `@topcli/prompts`.** One step, because an adapter that maps the new message-and-options calls back onto `prompts`'s question objects and answer shapes would be real work, thrown away at once. Add `@topcli/prompts@4.0.0` (exact; released 2026-07-05, more than seven days old).
    - **Types.** In `src/models.ts`, replace `PromptFn`, `PromptResult` and the `prompts` import with `Prompter` and its option types. Add type tests (`context.test-d.ts`): `confirm` resolves to `boolean`, `select` with literal choices to their union, `multiselect` to an array of it, runtime choices to `string`, and a missing `choices` is a type error.
    - **Context.** `createContext` builds the four methods. Each refuses with the same non-interactive `CommandError` and hint as today, and turns a cancel into "Cancelled.".
    - **Edge.** Rewrite `src/edges/prompts.ts`: `await import('@topcli/prompts')` only when a question is asked; map `confirm` to `confirm(message, { initial })`, `text` to `question(message, { defaultValue })`, `select` and `multiselect` to theirs (`selected` becomes `preSelectedChoices`); and pass `stdin`, `stdout` and a `signal`. While a question is open, the edge listens for Ctrl+C on stdin keypresses (`readline.emitKeypressEvents`) and aborts the controller. It removes the listener and restores raw mode in `finally`, and reports an error named `AbortError` as cancelled.
    - **Tests.** Port the `context.test.ts` and `run.test.ts` cases and the fixture commands that prompt to the new calls. The package is not loaded when no command prompts (as today, now with `vi.mock('@topcli/prompts')`). Each type maps its options. An `AbortError` becomes "Cancelled.". A Ctrl+C byte written to a fake TTY stdin (a `PassThrough` with `isTTY` and `setRawMode`) aborts the signal, and the listener is gone after the question.
    - `prompts` stays installed but unused until step 15, so this step is green on its own.
13. **`art state` (pure part).** `src/cli/state.ts` decides from the words (`[]`, `[doc]`, `[doc, --reset]`, plus `--yes`, `--json`, `--help`), from `interactive`, and from what the edges read: list, show, reset, ask then reset, or a `UsageError` (a second argument, an unknown flag, `--reset` without a document: exit 2). `interactive` is an input, never decided here. `state-command.ts` computes it the way a command run does: false under `--json`, false under `--yes`, and false without a terminal (spec 01's `canPrompt`). So for a reset the plan is: `--yes` resets without asking; otherwise, not interactive is the prompt's usual error; otherwise, ask. The plan checks the document name against `DOC_NAME` before anything else, and a failing name gives the same "No document" outcome as an unknown one. Tests are pure, one case each for `..`, `../x`, `a/b`, `Foo` and an empty name.
14. **`art state` (command).** `src/cli/state-command.ts`, wired in `launch.ts` next to `init`: shipped route only, and only after the project is found. Unlike a command run, it does not need the commands folder to exist; it needs `stateDir`. Behavior:
    - `art state`: lists the documents in `stateDir` (name, version, path relative to the current folder; absolute under `--json`). It lists `*.json` only: named locks and document locks (`*.lock`) and temp files (`*.tmp`) never appear. Each file is read through `inspectDocument`. One that cannot be read (corrupt JSON, unreadable) is listed with `version: null` and an `error`, and the text output shows the error after its name. The call still exits 0, because `--reset` is how such a document gets fixed. A missing folder prints "No state yet in <dir>." and exits 0 with `documents: []`.
    - `art state <doc>`: first checks `<doc>` against `DOC_NAME` (Data model); a name that fails is "No document <doc> in <dir>", exit 1, before any path is built. Then it prints the file's JSON (the `$version` wrapper included), or under `--json`, `result.data` with `version`. An unknown document exits 1 with "No document <doc> in <dir>" and a hint listing the ones that exist. A corrupt one exits 1 with the store's error and the hint "Reset it with --reset to start again from the defaults."
    - `art state <doc> --reset`: asks "Reset <doc>? The app starts again from its defaults." through the new `confirm` (default no). `--yes` skips the question. When it is not interactive (step 13) and `--yes` is absent, it fails with the prompt's usual error and the hint "Pass --yes to reset without a question." It checks the name the same way first. It deletes the file through `removeDocument`, under the document's lock and without reading it, so it never removes a file in the middle of an `update`, and it resets a corrupt document or one newer than the code just as well. An unknown document is the same exit 1 as for show.
    - It warns, like `init`, when the project has a command or topic called `state`, which the word hides.
    - `help` lists `init` and `state` under "Built-in"; `help --json` adds the `builtins` array (Data model); `art state --help` prints its usage.
    Tests drive it through `launch` with temp projects, fake streams and a fake prompt edge. The lock cases (a reset that waits for a holder, times out, or takes over a dead holder's lock) call `stateCommand` directly with fake `StateEdges` (Data model), and never sleep.
15. **Drop `prompts`.** Remove `prompts`, `@types/prompts`, the peer dependency and its meta; run `pnpm install`; commit the lockfile. `grep -r "from 'prompts'" src` finds nothing, and `pnpm ls --prod --depth Infinity` lists only `@topcli/prompts`.
16. **Docs.** README:
    - "Small": the one runtime dependency is `@topcli/prompts`, which has none of its own.
    - The `ctx.prompt` row and an example of each method, and a note that `--yes` never answers with a question's default: the command decides what `--yes` means.
    - A "Store kit" section (`defineStore`, documents, versions, named locks, the memory store, `stateDir`). It flags the trap in bold: `"artemis": { "stateDir" }` and `defineStore({ project })` are relative to the project root, while `defineStore({ dir })` is relative to the current folder, so a relative `dir` moves with wherever the user runs the command. Use `project`, or build an absolute `dir` from `import.meta.url`. It also says that `locked` and `update` take synchronous work only, and that long work goes in `store.lock`.
    - The worktrees section with `registry`.
    - `art state`.
    - "Upgrading from 0.1" (`ctx.prompt({ type: 'confirm', name, message })` becomes `ctx.prompt.confirm(message)`, and the same for `multiselect`, `select` and `text`; `stateFile: path` becomes `registry: defineStore({ dir }).doc(name, { fallback: {} })`, where `dir` is the old file's folder and `name` is its file name without `.json`, so it is the same file, content and lock; a different name, or an old file name that is not a valid document name, means renaming the file while nothing runs; the lock options move to `defineStore`).

    AGENTS.md: `ctx.prompt`'s four methods, `art state` in "Running the CLI" (list, show, reset, `--yes`), and `stateDir` in the settings. Remove the `@types/prompts` note.
17. **Checks and version.** `scripts/check-bin.mjs`: in a temp project with `"artemis": { "stateDir": "data" }`, a command that writes a document through `defineStore({ project: import.meta.url })` and then `art state --json`, `art state <doc> --json`, `art state <doc> --reset --json` (exit 1 with the `--yes` hint), and `--reset --yes --json` (the file is gone). Run it under the global `art` with no local copy of Artemis (the resolve hook from spec 01 covers `@zjaaal/artemis/store`). Set `version` to `1.0.0`. `pnpm pack --dry-run` still lists only `dist/`, `README.md`, `LICENSE` and `package.json`.
18. **Review and PR.** Run `/review-standards`, fix the findings, push `spec-02`, open one PR to `main`.

## Acceptance criteria

- [ ] `pnpm run test:all`, `pnpm run build`, `pnpm run check-exports`, `pnpm run check-bin` and `pnpm run check-lock` pass locally on the machine's Node, and in CI on Node 22 and 24 (the CI matrix is the proof for both versions).
- [ ] `/review-standards` reports nothing open: types only in `models.ts` files, constants in `constants.ts`, no magic numbers, no `any`, no enums, no nested loops, side effects only in `src/edges/` and the kits' edge files, JSDoc on exports, tests per §7.
- [ ] `package.json` has exactly one runtime dependency, `"@topcli/prompts": "4.0.0"`, no `peerDependencies`, and no `prompts` or `@types/prompts` in any field. `pnpm ls --prod --depth Infinity` lists only `@topcli/prompts`.
- [ ] `@topcli/prompts` is not loaded by a run in which no command prompts (asserted by a test).
- [ ] `ctx.prompt` has exactly `confirm`, `text`, `select` and `multiselect`. Type tests pin `boolean`, `string`, the union of literal choice values, and an array of that union.
- [ ] With `--yes`, under `--json`, or without a terminal, each of the four throws `CommandError` with `options.hint` or "Pass --yes to skip the question.", and the run exits 1 (one test per method).
- [ ] A Ctrl+C keypress on a fake TTY stdin during a question makes it fail with "Cancelled." (exit 1), and the keypress listener is removed afterwards.
- [ ] Manual check, recorded in the PR: in a real terminal, Ctrl+C at a `confirm` and at a `multiselect` exits 1 with "Cancelled." and leaves the terminal usable (cursor visible, echo on).
- [ ] `@zjaaal/artemis/store` exports `defineStore` and `createMemoryStore`, and `check-exports` asserts it.
- [ ] `store.doc(name)` writes `<dir>/<name>.json`. A name outside `^[a-z0-9][a-z0-9-]{0,63}$` is a `TypeError`.
- [ ] `read()` of a missing file returns a value that is not the `fallback` object (a deep copy). Mutating any value `read()` returned does not change the next `read()`.
- [ ] A write never leaves a partial file: the file is replaced by `rename`, and a failed write leaves no `*.tmp` behind (asserted in a temp folder).
- [ ] `update(fn)` whose `fn` returns `undefined` throws a `TypeError` and writes nothing. `write()` called inside `update()` or `locked()` completes without waiting.
- [ ] `locked(work)` whose `work` returns a promise, and `update(change)` whose `change` does, throw a `TypeError` that names `store.lock`, write nothing, and leave the lock released (a following `update` does not wait).
- [ ] Two processes each running `update` 50 times on one counter document end with 100.
- [ ] A version-0 document reads and writes plain JSON. A version-2 document reads a version-0 file through `upgrades[1]` and `upgrades[2]` and writes `{ "$version": 2, "data": ... }`. A file of version 3 read by version-2 code is a `CommandError` with a hint. A missing upgrade step is a `TypeError` from `store.doc`. A `read()` never writes.
- [ ] A corrupt document is a `CommandError` naming the file, whose hint names no binary.
- [ ] `store.lock(name, work)` runs overlapping calls one after the other, calls `onWait` once with the holder's pid, takes over a lock left by a dead process, releases in `finally`, and fails fast when this process already holds it.
- [ ] `createMemoryStore()` passes the same contract tests as the disk store.
- [ ] The lock tests of spec 01 (content before the file appears, guarded takeover, grace period, release only if still ours, `EPERM` is alive) pass against the moved lock core. No second lock implementation exists in `src/`: `grep -rln "createExclusive" src --exclude='*.test.ts'` lists exactly `src/edges/files.ts`, `src/kits/store/lock.ts` and `src/cli/init.ts` (init's never-overwrite writes); `src/kits/worktrees/lock.ts` and `lock-edges.ts` no longer exist; and `grep -rn "LOCK_SUFFIX" src --exclude='*.test.ts'` finds it only under `src/kits/store/`.
- [ ] `defineWorktrees` takes `registry` and has no `stateFile`, `now`, `isProcessAlive`, `pause` or `lockTimeoutMs`. Two concurrent `ensure` calls get different slots. A registry file and lock written by `0.1` are read and honored unchanged when the document is the old `stateFile` path (same folder, `name` equal to the old file name without `.json`, for example `instances` for `data/instances.json`); under any other name the document is a new file, as the upgrade note says.
- [ ] `"artemis": { "stateDir" }` is validated like the other keys. `defineStore({ project: import.meta.url })` and `art state` resolve the same folder from any file or subfolder of the project. The default is `<root>/state`.
- [ ] `art state` lists the `*.json` documents of `stateDir` (no `*.tmp`, and no `*.lock`, so named locks never appear) with name, version and path (relative to the current folder in text, absolute under `--json`). With no folder it prints "No state yet in <dir>." and exits 0.
- [ ] With one corrupt document among others, `art state` exits 0 and lists the others with their versions, and the corrupt one with `version: null` and an `error`.
- [ ] `art state <doc>` prints the document. Under `--json` it prints one `{ ok: true, command: "state", result: { name, version, file, data } }`. An unknown document exits 1 with a hint listing the existing ones.
- [ ] `art state ..`, `art state ../x`, `art state a/b` and `art state Foo`, with and without `--reset`, exit 1 with "No document … in <dir>", print no stack trace, and touch no file (a file planted outside `stateDir` at the path `../x` would point to is still there).
- [ ] `art state <doc> --reset` asks first. With `--yes` it deletes the file under the document's lock. When not interactive (under `--json`, or without a terminal), and without `--yes`, it exits 1 with the hint "Pass --yes to reset without a question." and the file is still there.
- [ ] `art state <doc> --reset --yes` deletes a corrupt document, and one whose `$version` is higher than any code knows, without reading it. `Doc.reset()` does the same.
- [ ] A second argument, an unknown flag, or `--reset` without a document exits 2.
- [ ] `state` is handled by the shipped `art` / `artemis` only: a project command called `state` is hidden there with a warning and still runs through `cli({ root })`. `art state` works in a project whose commands folder does not exist.
- [ ] `art help --json` on the shipped route has a `builtins` array with `init` and `state` in the shape of a command entry, and every other field of the manifest unchanged. A `cli({ root })` manifest has no `builtins`.
- [ ] `check-bin` runs `art state` against a document written by a command through `defineStore({ project })`, under a global `art` with no local copy of Artemis.
- [ ] README and AGENTS.md describe the store kit, `stateDir`, `art state`, the four prompt methods and "Upgrading from 0.1", and no longer mention `prompts` or `@types/prompts`.
- [ ] `docs/HANDOFF.md` points to spec 02 instead of holding the store and prompts backlog.
- [ ] `package.json` version is `1.0.0`.

## Decisions

- **Yes:** the store kit and the `prompts` replacement in one spec and one release (owner, 2026-11-11). Both break the public API, and `docs/HANDOFF.md` names them as the two things before `1.0.0`. Two specs would mean two breaking upgrades for the same users.
- **Yes:** `@topcli/prompts@4.0.0` (owner, 2026-11-11). It has zero dependencies, only `node:` imports, provenance, the same Node floor as ours, injectable streams and an `AbortSignal`. Its Ctrl+C gap is closed by Artemis's own listener (verified in a pty), and its missing `AbortError` export by checking the error's name.
- **No:** `@clack/prompts`. It is the most adopted and handles Ctrl+C itself, but it brings five packages and seven maintainers who can publish. The owner asked for lighter and more secure.
- **No:** `@inquirer/prompts`. Its `engines` conflict with `>=22`, and it brings about 17 packages.
- **No:** keeping `prompts` or moving to `enquirer`. Both are unmaintained and have no provenance.
- **No:** writing our own engine on `readline`. No dependency at all, but Artemis would own the raw-mode `multiselect` and its terminal quirks. A zero-dependency library already does that job.
- **No:** a pluggable prompt engine. One edge is the seam, and swapping libraries later changes no public type, because the types are Artemis's own.
- **Yes:** a typed `ctx.prompt` with four methods returning the answer (owner, 2026-11-11), over keeping `prompts`-style question objects. Types come from the call, no `@types/prompts` is needed, and nobody has to destructure `{ name }` out of an answers object. The cost is rewriting the five call sites in the scripts repo, in that repo's own spec.
- **Yes:** `options.hint` keeps meaning "the hint when nobody can answer", as today. It is what agents read, and `@topcli/prompts`'s on-screen hint is not exposed.
- **Yes:** choice values are strings. `@topcli/prompts` returns strings, and a CLI answer is text anyway.
- **Yes:** Artemis models nobody's state (owner, 2026-11-11). The app chooses the folder, names, shapes and defaults. `steps.json` and `feature-flags.json` stay the scripts repo's files.
- **Yes:** documents are synchronous and named locks are asynchronous, on one lock core. A document update holds the lock for milliseconds, while a build lock waits minutes and tells the caller who it waits for. The lock moves out of the worktrees kit instead of a third one being written.
- **Yes:** the document lock is reentrant within a process, and the named lock is not and fails fast instead. Synchronous work cannot interleave, so reentrancy is safe there and makes `write()` inside `update()` work. Async work can interleave, so a nested named lock is a bug, reported at once.
- **Yes:** version 0 is plain JSON, and versions 1+ are `{ "$version", "data" }`. Every file on disk today stays valid with no migration. A file newer than the code is an error, never a silent downgrade. Reads upgrade in memory and never write, so a read needs no lock.
- **Yes:** `update(fn)` throws when `fn` returns `undefined`. A forgotten `return` would otherwise write `null` or silently skip. `locked(fn)` is for a read-modify-write that may write nothing.
- **Yes:** fallbacks are `structuredClone`d on every read. That removes the `flags apply` class of bug without the kit knowing what a flag is.
- **Yes:** an in-memory store with the same API, held as JSON strings so it copies and fails like the disk does. Commands that keep state become testable without touching disk.
- **Yes:** the worktrees kit takes `registry: Doc<WorktreeRecords>`, and `stateFile` is removed (owner, 2026-11-11). It is the same file, content and lock file name, so running data needs nothing. The breaking change lands in `1.0.0` with the rest. This supersedes spec 01's "the worktrees kit keeps taking `stateFile`".
- **Yes:** `art state` exists and is a fixed word of the shipped binary, like `init` (owner, 2026-11-11). A kit cannot ship command files, and an agent needs to see and reset state without reading code.
- **Yes:** `art state` lists, shows and resets (owner, 2026-11-11). Reset asks, `--yes` skips, and without a terminal it fails with a hint, the same contract as any prompt.
- **No:** `art state <doc> --set <json>` (owner, 2026-11-11). It writes data the app's code never checked.
- **Yes:** `state` is reserved on the shipped route only, like `init` (owner, 2026-11-11). A published tool's command names stay its own.
- **Yes:** `"artemis": { "stateDir" }`, default `state`, also read by `defineStore({ project })` (owner, 2026-11-11). The shipped binary never loads app code, so the folder must be declared where both can read it, and one declaration means the two cannot disagree. `defineStore({ dir })` stays for full control and for published tools.
- **Yes:** reset deletes the file instead of writing the fallback. `art state` cannot know the fallback (it lives in app code), and a missing file is exactly what makes the app use it.
- **Yes:** `help --json` gains `builtins` on the shipped route. Agents read the manifest first, and a built-in word they cannot discover does not exist for them. A new key, not a change to existing ones, keeps every current reader working.
- **Yes:** the version becomes `1.0.0` at the end of this spec, as `docs/HANDOFF.md` decided on 2026-11-10.
- **No:** JSON-only is not a limit to fix here. The generated `compose-*.yml` files are outputs, not state. They stay plain files in the scripts repo.

## Risks

| Risk | Mitigation |
| --- | --- |
| `@topcli/prompts` is less adopted, so bugs surface later | Exact pin; every call goes through `src/edges/prompts.ts`; public types are Artemis's own, so a swap is internal; the manual Ctrl+C check is in the acceptance criteria. |
| A future `@topcli/prompts` release starts handling Ctrl+C itself and double-aborts | The pin is exact. An upgrade is a deliberate change, and the edge's Ctrl+C test catches a double handling. |
| A terminal reporting 0 columns renders `ESC[InfinityA` | Only seen in a pty with no size. Real terminals report a width. Noted for an upstream report; not worked around. |
| Raw mode left on after a crash mid-question breaks the user's terminal | The edge restores raw mode and removes its listener in `finally`. The manual check confirms the terminal stays usable. |
| Two copies of Artemis (a global `art` and a project's local copy) both hold the in-process reentrancy set | Reentrancy is per copy, and the lock file is shared, so two copies in one process exclude each other like two processes. That is safe; at worst a nested call across copies waits until its timeout. It is documented. |
| `defineStore({ project })` used inside a globally installed published tool resolves into `node_modules` | Documented: a published tool passes `dir`. `project` uses the shipped-route search, which stops at `node_modules` boundaries per spec 01. |
| An app writes a `"$version"` key into a version-0 document by hand | Accepted ambiguity, stated in the Data model. The key is Artemis's, and the README says so. |
| A relative `defineStore({ dir })` resolves from the current folder while `stateDir` resolves from the project root, so `art state` and the app see different folders | `project` is the recommended form; the README flags the difference in bold; `art state` prints the folder it reads, so a mismatch is visible. |
| An async function passed to `locked` or `update` escapes the lock | Runtime check: a thenable is a `TypeError`, the lock is released, and nothing is written. |
| `art state <doc> --reset` while the app is mid-`update` | The reset takes the document's lock, so it waits for the update to finish. |
| Users on `0.1` upgrade and their `ctx.prompt` calls break at runtime ("is not a function") | Major version bump, plus an "Upgrading from 0.1" section with the exact mapping. The type tests make TypeScript and `// @ts-check` users see it at compile time. |
| The `builtins` key surprises a strict manifest reader | It is a new top-level key. No existing key changes name or place, and the spec 01 manifest test keeps pinning them. |

## Handoff

- **Runs in:** the artemis checkout via `/spec-impl 02 delegated`. The brief gives the absolute path of the scripts repo checkout, read-only, used only as a reference for the use case. No path is written into this repo.
- **Reads first:** `docs/CODE_STANDARDS.md` (binding), spec 01 (the lock behavior and the shipped-binary rules this spec reuses), and this spec's "Why this spec exists".
- **May:** create `spec-02` from `main`; commit each step; add `@topcli/prompts@4.0.0` and remove `prompts` and `@types/prompts`; push `spec-02`; open one PR to `main`.
- **Must not:** merge; tag or release; `npm publish` or `npm stage`; touch the scripts repo; add a dependency this spec doesn't name; change spec 01.
- **Node versions:** the checks run on the machine's Node, and only CI runs both 22 and 24. The report states the local version, and the PR waits for the CI matrix before it counts as done.
- **Stops and reports when:** a step needs a decision this spec doesn't make; `@topcli/prompts@4.0.0` behaves differently from what is written here (exports, Ctrl+C, options); a check fails twice.
- **Reports:** steps done, PR link, commands run with results, the manual Ctrl+C check, open questions, bugs found by tests.

## What is **not** in this spec

- Moving the scripts repo onto the store kit and the typed `ctx.prompt` (its own spec in that repo).
- `art state --set`, and `state` on published tools' own CLIs.
- Prompt types beyond `confirm`, `text`, `select` and `multiselect`, and a pluggable prompt engine.
- Non-JSON documents, a user-level state folder, merged documents or a database.
- Releasing `1.0.0` (the owner tags and approves it).

Each one, if it lands, goes in its own spec.
