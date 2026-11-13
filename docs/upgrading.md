[Back to the README](../README.md)

# Upgrading

## Upgrading to 1.2

`1.2.0` changes the shape of `help --json`, so a reader that indexes it has to change (a minor release, not a major one: Artemis has no outside users yet):

- **Keys that hold their default are left out** of every manifest entry: `aliases` and `examples` when empty, `destructive` and `dryRun` when `false`, `required` when `false`, `default`, `choices` and `short` when there are none, `multiple` when `false`. Read a missing key as its default. `id`, `description`, `usage`, `args` and `flags` are always there.
- **`usage` has a new format**, the same everywhere: the id, the args and the flags spelled out (`db prune [target] [--older-than <value>] [--all]`), with no bin and no `[flags]`. Text help puts the bin in front.
- **The brief listing** has `usage` on each command, a `commands` count on each topic (a topic with no description has no `description` key), `builtins` as a list of ids, `globalFlags` and `search`. Above 40 commands its top level shows topics, not commands.
- **`history` is a word of the shipped `art`.** A command or topic called `history` is hidden there, with a warning (and reported by `art doctor`): rename it.
- **`help --agents` prints only the calling contract.** `help --authoring` prints the rest (writing a command and running the CLI).
- **A usage error has a `hint`** with the command's usage and the global flags, and an unknown command a better one.
- **`audit.jsonl`** in the state folder records every run of a project command through the shipped `art`. `"artemis": { "audit": false }` turns it off, and `art init` adds it to `.gitignore`. A published tool does not write one.

**New:** `help --search`, `help --authoring`, `art history`, `ctx.exec` with `detached` and `errorPattern`, the pointer `art init` adds to `AGENTS.md`, a "Writing a command" section in the generated skill, and command health in `art doctor`.

## Upgrading to 1.1

`1.1.0` reserves names and adds a limit, so a project that used them has to change (a minor release, not a major one: Artemis has no outside users yet):

- The flags `--dry-run`, `--quiet` and `--log` are global now. `defineCommand` throws a `TypeError` for a command that declares any of them: rename it.
- The words `skill` and `doctor` are handled by the shipped `art`. A command or topic with one of those names is hidden there, with a warning (and reported by `art doctor`): rename it.
- The worktrees kit refuses port bases that share a port in two slots below `maxSlots` (default `20`, slot 0 included), a port outside `1024` to `49151`, and a `slotStep` or `maxSlots` that is not a whole number above `0`, when `defineWorktrees` is called. An app that runs more than 19 extra instances at once has to raise `maxSlots`.

**New:** `help --brief`, `destructive` and `dryRun`, `--dry-run`, `ctx.next`, `ctx.exec`, `--quiet` and `--log`, `art skill`, `art doctor`, `help --agents`, a `label` for named locks, and a check for ports already in use when a new slot is given out.

## Upgrading from 0.1

`1.0.0` changes three things, once.

**`ctx.prompt` is four methods that return the answer.** The question-object format of 0.1 and the two packages behind it (the prompt library and its optional types peer dependency) are gone:

| 0.1                                                                                         | 1.0                                                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `const { ok } = await ctx.prompt({ type: 'confirm', name: 'ok', message })`                 | `const ok = await ctx.prompt.confirm(message)`                               |
| `ctx.prompt({ type: 'text', name, message, initial })`                                      | `ctx.prompt.text(message, { initial })`                                      |
| `ctx.prompt({ type: 'select', name, message, choices: [{ title, value }] })`                | `ctx.prompt.select(message, { choices: [{ label, value }] })`                |
| `ctx.prompt({ type: 'multiselect', name, message, choices: [{ title, value, selected }] })` | `ctx.prompt.multiselect(message, { choices: [{ label, value, selected }] })` |
| `ctx.prompt(question, { hint })`                                                            | the same `{ hint }` goes in the options of each method                       |

Choice values are strings. Calling `ctx.prompt(...)` the old way fails with JavaScript's own `ctx.prompt is not a function`, and TypeScript and `// @ts-check` show it at compile time. If your project listed that types package only for Artemis, remove it.

**The worktrees kit takes a document, not a file.** `stateFile: path` becomes `registry: defineStore({ dir }).doc(name, { fallback: {} })`, where `dir` is the old file's folder and `name` is its file name without `.json`. That is the same file, the same content and the same lock file, so a `0.1` process and a `1.0` process running at once still exclude each other. If the old file name is not a valid document name (`Instances.json`) or you want another name, rename the file while nothing runs. The lock options (`now`, `isProcessAlive`, `pause`, `lockTimeoutMs`) move from `defineWorktrees` to `defineStore`.

```js
// 0.1
defineWorktrees({ stateFile: '/app/data/instances.json', mainCheckout, ports });

// 1.0
const store = defineStore({ dir: '/app/data' });

defineWorktrees({ registry: store.doc('instances', { fallback: {} }), mainCheckout, ports });
```

**New:** the store kit, `art state` and the `"artemis": { "stateDir" }` setting. Nothing to change for them.
