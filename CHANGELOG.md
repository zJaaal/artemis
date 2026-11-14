# Changelog

What changed in each release, newest first. Breaking entries link to their section of [docs/upgrading.md](docs/upgrading.md). A change that is merged but not released yet goes under Unreleased.

## Unreleased

### Added

- `art new <command words>... --description <text>` writes the file of a new command, never over one that exists. `new` is a word of the shipped `art` now: a command or topic called `new` is hidden there.
- A published tool turns the audit trail on with `"artemis": { "audit": true }` and then has the word `history`; `run()` callers get `readHistory` and the documented `auditFile` option.
- `destructive` can be a function of the call's `args` and `flags`, so `start --no-prune` can skip the confirmation that `start` needs.

### Fixed

- `ctx.exec` starts `.cmd` and `.bat` files on Windows (`npm`, `pnpm`, `npx` and everything in `node_modules/.bin`): through `cmd.exe`, with every argument escaped so nothing in it is interpreted.
- The worktrees kit recognizes a checkout on Windows: paths are the real paths the disk reports (short names expanded) and compare without regard to case.
- The store's atomic write tries again on Windows when another process has the file open (EPERM, EACCES, EBUSY), instead of failing at once.
- Stopping a child of `ctx.exec` on Windows ends everything it started too (`taskkill /T /F`), where before a dev server's workers survived.
- A path under a file is "not a folder" on Windows too (it said "missing"), so `art state` with a `stateDir` under a file fails with a hint on every platform: "The state folder ... is not a folder" replaces "Cannot read the state folder".

## 1.2.0 (2026-11-14)

### Breaking

- Manifest entries leave out every key that holds its default, and `usage` has one new format ([upgrading](docs/upgrading.md#upgrading-to-12)).
- `history` is a word of the shipped `art`: a command or topic of that name is hidden ([upgrading](docs/upgrading.md#upgrading-to-12)).
- `help --agents` prints only the calling contract; `help --authoring` prints the rest ([upgrading](docs/upgrading.md#upgrading-to-12)).

### Added

- `help --search`, `help --authoring` and `art history`, with the audit trail in `<stateDir>/audit.jsonl`.
- `ctx.exec` with `detached` and `errorPattern`.
- The pointer `art init` adds to `AGENTS.md`, a "Writing a command" section in the generated skill, and command health in `art doctor`.

### Changed

- A usage error has a `hint` with the command's usage and the global flags, and an unknown command a better one.

## 1.1.0 (2026-11-12)

### Breaking

- `--dry-run`, `--quiet` and `--log` are global flags: a command that declares one throws a `TypeError` ([upgrading](docs/upgrading.md#upgrading-to-11)).
- `skill` and `doctor` are words of the shipped `art`: a command or topic of that name is hidden ([upgrading](docs/upgrading.md#upgrading-to-11)).
- The worktrees kit validates port bases, `slotStep` and `maxSlots` when `defineWorktrees` is called ([upgrading](docs/upgrading.md#upgrading-to-11)).

### Added

- `help --brief`, `destructive` and `dryRun`, `--dry-run`, `ctx.next`, `ctx.exec`, `--quiet` and `--log`.
- `art skill`, `art doctor` and `help --agents`.
- A `label` for named locks, and a check for ports already in use when a new slot is given out.

## 1.0.0 (2026-11-11)

### Breaking

- `ctx.prompt` is four methods that return the answer, on `@topcli/prompts` ([upgrading](docs/upgrading.md#upgrading-from-01)).
- The worktrees kit takes a `registry` document instead of `stateFile` ([upgrading](docs/upgrading.md#upgrading-from-01)).

### Added

- The store kit (`@zjaaal/artemis/store`), `art state` and the `"artemis": { "stateDir" }` setting.

## 0.1.2 (2026-11-11)

### Fixed

- `help <topic> --json` returns only that topic: the topic, its sub-topics and the commands under it.

## 0.1.1 (2026-11-11)

### Changed

- README positioning, and the release steps moved out of the README.

## 0.1.0 (2026-11-10)

Tagged and staged, never published.

### Added

- Artemis in strict TypeScript: commands found by walking a folder, `defineCommand`, `--json`, exit codes, the worktrees kit and the terminal kit.
