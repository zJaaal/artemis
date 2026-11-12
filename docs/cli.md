[Back to the README](../README.md)

# Using the CLI

```
art <topic> <command> [args] [flags]
```

### Flags every command has

| Flag           | What it does                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-h, --help`   | Show help for the command.                                                                                                                                                                                                           |
| `--json`       | Print the result (or the error) as one JSON object on stdout.                                                                                                                                                                        |
| `-y, --yes`    | Never prompt; use flags, saved values or defaults.                                                                                                                                                                                   |
| `--dry-run`    | Say what the command would do, and do none of it. Only for commands with `dryRun: true`; a usage error on any other.                                                                                                                 |
| `--quiet`      | Hide warnings, `Next:` lines, the version warning and child output. The result, the dry-run plan and errors still print.                                                                                                             |
| `--log <file>` | Write everything the command and its child processes print to this file (truncated at the start), even what `--quiet` hides. Its absolute path is `log` in the envelope. A file that cannot be opened fails before the command runs. |

Global flags may be typed before or after the command name: `art --json math add 1 2` and `art math add 1 2 --json` are the same. Any other flag has to come after the command. After `--`, everything is a plain argument (`art echo -- --json` echoes the text `--json`).

### Getting help

| Ask                                 | You get                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `art` or `art help`                 | the topics and top-level commands                                                                      |
| `art <topic>` or `art <topic> help` | every command inside the topic                                                                         |
| `art <command> --help`              | the command's arguments, flags, defaults, choices, aliases and examples                                |
| `art help --json`                   | the manifest of every command, as data                                                                 |
| `art help <topic> --json`           | the manifest narrowed to one topic: same shape, only its commands                                      |
| `art help <command> --json`         | the manifest entry of one command                                                                      |
| `art help --json --brief`           | only ids and one-line descriptions (and `destructive`, `dryRun` when true), and how to get one in full |
| `art help <topic> --json --brief`   | the same, narrowed to one topic                                                                        |
| `art help --agents`                 | the [AGENTS.md](../AGENTS.md) of the running copy of Artemis                                           |

On the shipped `art`, `help` also lists the words the binary handles itself (`init`, `state`, `skill` and `doctor`) under **Built-in**, and `help --json` adds them as a top-level `builtins` array in the same shape as `commands`. `art help state` and `art help init` (with or without `--json`) describe them like a command, and a typo close to one suggests it. A tool published with its own bin file has no `builtins`.

### The JSON contract

With `--json`, every call prints **exactly one object** on stdout and nothing else:

```jsonc
// success
{ "ok": true, "command": "math add", "result": { "sum": 3 } }

// failure
{ "ok": false, "command": "math add", "error": "Both arguments must be numbers", "hint": "Try: math add 1 2" }
```

`hint` is left out when there is none, and `command` is `null` when no command was resolved (for example an unknown command). Warnings go to stderr, so stdout stays parseable.

More keys come after those, always in this order (`dryRun`, `plan`, `next`, `log`, `tail`, `checks`) and only when they apply:

```jsonc
// success: ctx.next collected a line, and --log was given
{ "ok": true, "command": "dotcms start", "result": { "instance": "bench-art" },
  "next": ["art dotcms wait --instance bench-art --json"], "log": "/abs/start.log" }

// success under --dry-run
{ "ok": true, "command": "dotcms prune", "result": { "pruned": false }, "dryRun": true,
  "plan": ["docker volume rm dotcms-bench-art_dbdata"] }

// failure of a child run through ctx.exec
{ "ok": false, "command": "dotcms build", "error": "mvn exited with code 1",
  "hint": "Full log: /abs/build.log", "log": "/abs/build.log", "tail": ["[ERROR] Failed to execute goal ..."] }
```

`dryRun` and `plan` are on every success under `--dry-run` (`plan` is `[]` when nothing was planned), `next` when `ctx.next` collected a line (under `--dry-run` too, never on failure), `log` whenever the `--log` file was opened, and `tail` only on a failure that came from `ctx.exec` with output. A failing `art doctor` adds `checks`.

The manifest from `help --json` has this shape:

```jsonc
{
    "bin": "art",
    "topics": [{ "id": "math", "description": "Arithmetic" }],
    "commands": [
        {
            "id": "math add",
            "description": "Add two numbers",
            "usage": "art math add <a> <b> [flags]",
            "aliases": ["sum"],
            "args": [
                {
                    "name": "a",
                    "description": "First number",
                    "required": true,
                    "default": null,
                    "choices": null
                }
            ],
            "flags": [
                {
                    "name": "round",
                    "type": "boolean",
                    "short": "r",
                    "multiple": false,
                    "description": "Round the result",
                    "default": null,
                    "choices": null
                }
            ],
            "examples": ["math add 1 2"]
        }
    ],
    "globalFlags": [/* help, json, yes, dry-run, quiet, log */]
}
```

Every command entry also has two booleans after `examples`, always present: `"destructive"` and `"dryRun"`. The brief manifest of `help --json --brief` leaves out everything but what an agent needs before it calls:

```jsonc
{
    "bin": "art",
    "topics": [{ "id": "dotcms", "description": "Run dotCMS instances" }],
    "commands": [
        { "id": "dotcms start", "description": "Start the instance of this worktree" },
        {
            "id": "dotcms prune",
            "description": "Delete an instance's data",
            "destructive": true,
            "dryRun": true
        }
    ],
    "builtins": [{ "id": "state", "description": "..." }], // the shipped art only
    "more": "art help <command> --json"
}
```

`topics` lists every topic that has a command in the listing, at any depth, by full id. `help <command> --json --brief` is a usage error: one command is already the small level.

### Exit codes

| Code | Meaning                                                                            | In code            |
| ---- | ---------------------------------------------------------------------------------- | ------------------ |
| `0`  | success                                                                            | `EXIT_CODE.OK`     |
| `1`  | the command failed (a `CommandError`, or a bug)                                    | `EXIT_CODE.FAILED` |
| `2`  | the command line was wrong: unknown command, bad or missing argument, unknown flag | `EXIT_CODE.USAGE`  |

### `art state`: see and reset what the app keeps

An app that keeps state (see the [store kit](kits/store.md)) keeps it in one folder, `"artemis": { "stateDir" }` in `package.json` (default `state`). `state` is a word of the shipped `art`, like `init`, so you and your agent can look at it without reading code:

```console
$ art state                       # list the documents: name, version, path
$ art state steps                 # show one (its JSON, the version wrapper included)
$ art state steps --reset         # delete it, so the app starts again from its defaults (asks first)
$ art state steps --reset --yes   # the same, with no question
```

- Under `--json` it prints one object: `{ dir, documents: [{ name, version, file }] }` for the list, `{ name, version, file, data }` for a document and `{ name, file, reset: true }` for a reset. A document that cannot be read is listed with `version: null` and an `error`, and a reset deletes it anyway.
- A reset never prompts under `--json` or without a terminal: without `--yes` it fails with the hint `Pass --yes to reset without a question.`
- A reset takes the document's lock, so it never removes a file in the middle of an update.
- An unknown document, or a name that could not be a document, exits `1` and lists the ones that exist. A wrong command line (a second argument, an unknown flag, `--reset` with no document) exits `2`.
- `state` only exists on the shipped `art` / `artemis`. A command of yours called `state` is hidden there, with a warning, and still runs through a tool published with `cli({ root })`.

### Prompts

`ctx.prompt` has four questions. Each returns the answer itself, so there is nothing to destructure:

```js
async run({ ctx }) {
    if (!ctx.interactive) return { confirmed: true };

    const confirmed = await ctx.prompt.confirm('Sure?'); // boolean; `initial: true` makes Return answer yes
    const name = await ctx.prompt.text('Name?', { initial: 'world' }); // string; Return answers `initial`

    const runner = await ctx.prompt.select('Runner?', {
        choices: [
            { label: 'Node', value: 'node', description: 'The default' },
            { label: 'Deno', value: 'deno' }
        ]
    }); // 'node' | 'deno' in TypeScript

    const steps = await ctx.prompt.multiselect('Steps?', {
        choices: [
            { label: 'Build', value: 'build', selected: true },
            { label: 'Test', value: 'test' }
        ]
    }); // ('build' | 'test')[]

    return { confirmed, name, runner, steps };
}
```

- In a terminal the user answers. Choice values are strings, and with literal choices TypeScript narrows the answer to their union (choices built at runtime give `string`).
- `--yes` and `--json` mean nobody can answer, so `ctx.interactive` is `false` and every question throws a `CommandError`. The same happens when there is no terminal (a pipe, an agent, CI).
- **`--yes` never answers a question with its default.** What `--yes` means is the command's decision: it reads `ctx.interactive` (or `flags.yes`) and skips the question, as in the example above. A `confirm` with `initial: true` still throws under `--yes`.
- The hint of that error says how to answer without a prompt. Pass your own: `ctx.prompt.confirm('Sure?', { hint: 'Pass --yes to accept the default.' })`. Without one, the hint says to pass `--yes`, or, when `--yes` or `--json` was already passed, that the command asks regardless and has to be answered with the flags it documents.
- Ctrl+C at a question fails the command with `Cancelled.` (exit `1`).
- The good pattern: check `ctx.interactive`, and fall back to flags, saved values or defaults when it is `false`.

### `art skill` and `art doctor`

`skill` and `doctor` are words of the shipped `art`, like `init` and `state`. They are not reserved for a tool published with `cli({ root })`.

```console
$ art skill                                   # print a short SKILL.md built from your commands
$ art skill --write .claude/skills/art/SKILL.md   # write it (creating folders); asks before overwriting
$ art doctor                                  # check the install and the project, with a fix for each problem
```

`art skill` fills a fixed template from the manifest: frontmatter with the bin and the package description (always a quoted YAML string), how to find and call a command, the destructive commands (with `--dry-run` where marked) and up to ten examples. It has no usage line, argument or flag, and points at `help <command> --json` for those, so it never goes stale. It never overwrites a file without asking: in a terminal it asks, and otherwise it needs `--yes`.

`art doctor` reports `version`, `range` (the range the project asks for against the version that runs), `installed` (the copy the project installs, found as Node resolves a package), `project`, `module`, `commands`, `words` (no command hides a word of the binary) and `state`, each `ok`, `warn` or `fail`, with a `fix` for every one that is not ok. It exits `1` only when a check fails, and with no project it reports `version`, `installed` and `project` (which fails). On every other run of the shipped `art`, one line on stderr says when the running version is not the one the project wants or installs (`--quiet` hides it, and it never enters the JSON envelope). Ranges understood: exact, `^` (with its 0.x meaning), `~`, `>=`, `>`, `<=`, `<`, `*`, `x`-ranges, partials and `||`; anything else (`workspace:`, `file:`, `link:`, a git URL, a tag, a space-joined range, a prerelease) is "not checked", never a warning.
