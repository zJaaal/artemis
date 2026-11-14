[Back to the README](../README.md)

# Projects and settings

## How `art` finds your project

`art` looks at each `package.json` from the current folder up through its parents, and the **project** is the nearest one that says it is one, in either of two ways:

- **It declares itself**: it has an `"artemis"` key. This is what `art init` writes, and it is the explicit way: nothing is guessed.
- **It follows the convention**: it has a `commands/` folder next to it. This needs no setup.

Any other `package.json` is simply not a candidate and is skipped: a `{ "type": "module" }` file in `src/` or `dist/` (with or without other keys, such as `sideEffects`), a template, or a monorepo package that has neither. So `art` works from any folder inside your project, and a monorepo package without its own commands uses the root's. Two projects on one machine never see each other's commands.

All settings are optional, under the `artemis` key of that `package.json`:

```json
{
    "artemis": {
        "commandsDir": "tools/commands",
        "bin": "mytool",
        "stateDir": "data",
        "audit": false
    }
}
```

| Setting       | What it does                                                                                                          | Default                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `commandsDir` | The commands folder, relative to the folder of that `package.json`.                                                   | `commands`                                                             |
| `bin`         | The name help and usage lines show.                                                                                   | `art` (see [Your own command name](#your-own-command-name) for a tool) |
| `stateDir`    | Where the store kit keeps its documents, relative to that folder. Read by `art state` and `defineStore({ project })`. | `state`                                                                |
| `audit`       | `false` stops `art` from appending each run to `audit.jsonl` in the state folder (what `art history` reads).          | `true`                                                                 |

`art` always shows `art` (or your `bin` setting) in help, even in a project that publishes a CLI of its own, so what the help tells you to type is what you typed.

When it cannot find what to run, `art` exits `1` and says what to create or set, and with `--json` it prints the usual failure object with `command: null`:

| Problem                                                            | What the hint tells you                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no project from here upwards                                       | a project is the nearest `package.json` with an `artemis` key or a `commands/` folder next to it; run it inside one, or run `init` in this folder                                                                                             |
| the commands folder does not exist                                 | create it, set `"artemis": { "commandsDir" }`, or point it at a parent's commands (`"../commands"`)                                                                                                                                           |
| the `artemis` key has a bad shape                                  | the shape it should have                                                                                                                                                                                                                      |
| any `package.json` on the way up is not valid JSON or not readable | the file, and what is wrong with it. It is never skipped, because running a different project's commands silently would be worse (a deliberately broken fixture between you and the project makes `art` fail until you run it from elsewhere) |

## Your own command name

To ship the same CLI under your own name (say you publish a package `mytool`), give it a bin file:

```js
#!/usr/bin/env node
// bin/mytool.js
import { cli } from '@zjaaal/artemis/cli';

process.exitCode = await cli({ root: import.meta.url });
```

and point `package.json` at it, with `@zjaaal/artemis` as a dependency:

```json
{
    "name": "mytool",
    "type": "module",
    "bin": { "mytool": "bin/mytool.js" },
    "dependencies": { "@zjaaal/artemis": "^1.2.0" }
}
```

`root` is where your bin file is: your tool runs **its own** `commands/`, wherever the user happens to be standing, not the commands of whatever project the user is in. It finds its package through the nearest `package.json` with a name, a `bin` or an `artemis` key, and never looks past its own folder in `node_modules`, so it never climbs into the project that installed it, even if you forgot to declare a `bin`. Make sure `commands/` ships with your package (check `files` in your `package.json`): a tool published without its commands fails with "Commands folder not found" and a hint for you, instead of running the commands of the project that installed it. Nothing is reserved for a tool: `init` and every other word is yours. Help and usage lines show `mytool`, taken from the single key of your `bin` object, or from your package name (without its `@scope/`) when `bin` is a plain string or has several keys, or from `"artemis": { "bin" }` if you set it. `cli` resolves to the exit code and never calls `process.exit`; it also takes `argv` and the host options of `run()` (`stdout`, `stderr`, `interactive`, `color`, `env`) if you need them.

For full control of the commands folder, the streams and the exit code, call [`run(argv, options)`](run.md) from your own bin file.
