# Artemis

**Drop an arrow in the quiver, get a command.**

Artemis turns a folder of files into a command line. Every file is a command, every folder is a topic, and there is no registry to keep up to date. It was built so that AI agents can write their own CLI tooling: an agent drops one file in a folder and gets a command, and everything it needs to call that command (arguments, flags, defaults, allowed values, examples) is machine-readable.

> The name and the arrow and quiver picture are branding: an arrow is a command, a quiver is a folder of them. The API and the help text keep plain terms (`command`, `topic`).

- ESM only, Node 22 or newer, strict TypeScript types included.
- `help --json` describes every command; `--json` makes every call print one JSON object; exit codes are `0`, `1` and `2`.
- One runtime dependency (`prompts`), loaded only when a command asks a question.

## Install

```sh
pnpm add @zjaaal/artemis
# or: npm install @zjaaal/artemis
```

TypeScript users who read the types of `ctx.prompt` also need `@types/prompts`.

## Quick start

A bin file (`bin/art.js`) runs the CLI. `bin` is required: it is the name help and usage lines show.

```js
#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '@zjaaal/artemis';

const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../commands');

process.exitCode = await run(process.argv.slice(2), { bin: 'art', commandsDir });
```

A command is a file:

```js
// commands/hello.js
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Greet someone',
    args: [{ name: 'name', description: 'Who to greet', default: 'world' }],
    flags: { shout: { type: 'boolean', short: 's', description: 'Uppercase the greeting' } },
    run({ args, flags, ctx }) {
        const greeting = `hello ${args.name}`;
        const text = flags.shout ? greeting.toUpperCase() : greeting;

        ctx.log(text);

        return { greeting: text };
    }
});
```

```console
$ node bin/art.js hello ana --shout
HELLO ANA

$ node bin/art.js hello ana --json
{"ok":true,"command":"hello","result":{"greeting":"hello ana"}}
```

Folders are topics: `commands/math/add.js` is `art math add` (and `art math:add`). A `_topic.js` file with `defineTopic({ description })` describes the topic. Files and folders starting with `_` or `.` are private.

## Typed arguments and flags

`run({ args, flags })` is typed from the definition, so command files get editor feedback even in plain JavaScript with `// @ts-check`:

```js
// @ts-check
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Pick a color',
    args: [{ name: 'color', choices: ['red', 'blue'], default: 'red' }],
    flags: { tag: { type: 'string', multiple: true } },
    run({ args, flags }) {
        args.color; // 'red' | 'blue'
        flags.tag; // string[] | undefined
        // args.size  -> type error: not declared
    }
});
```

A required or defaulted arg is a `string`, an optional one is `string | undefined`, `choices` narrow to their union, a boolean flag is `boolean | undefined` (`boolean` with a default), and a `multiple` flag is `string[]`.

## For agents

Everything an agent needs is in [AGENTS.md](AGENTS.md): how to add a command, the JSON envelope, the exit codes, `--yes` and prompts. The short version:

- `art help --json` lists every command with its args, flags, defaults, choices and examples.
- With `--json`, a call prints `{ "ok": true, "command", "result" }` or `{ "ok": false, "command", "error", "hint" }`.
- Exit codes: `0` success, `1` the command failed, `2` the command line was wrong.
- `--yes` never prompts. A prompt that nobody can answer throws an error whose hint says which flag to pass.

## Kits

Opt-in pieces, imported from their own subpath so apps that do not need them do not load them.

### Worktrees: `@zjaaal/artemis/worktrees`

One instance per checkout of a repo: a stable slot, ports shifted by that slot and a color, so several copies of an app can run side by side. The main checkout is slot 0; other worktrees register on first use and keep their slot until removed. The kit keeps nothing of its own: the app says where the registry lives (`stateFile`).

```js
import { defineWorktrees } from '@zjaaal/artemis/worktrees';

const worktrees = defineWorktrees({
    stateFile: '/path/to/data/instances.json',
    mainCheckout: '/path/to/main/checkout',
    ports: { http: 8080, frontend: 4200 }
});

const instance = worktrees.ensure(); // registers the checkout you are in, on first use
instance.ports; // { http: 8180, frontend: 4300 } for slot 1
```

### Terminal: `@zjaaal/artemis/terminal`

Terminal tabs as data, opened by an adapter. Only Warp is supported for now.

```js
import { openTabs, warp } from '@zjaaal/artemis/terminal';

openTabs(warp(), [
    {
        id: 'demo',
        name: 'demo',
        panes: [
            { dir: '/work/demo', run: ['art up'] },
            { dir: '/work/demo', run: ['art wait'], focus: true }
        ]
    }
]);
```

A tab can also take a `layout` tree of nested splits instead of a flat `panes` list.

## Releasing

Agents cannot log in to npm, so the owner does the first publish by hand and links the trusted publisher once.

1. Merge the release PR. On a machine logged in to npm (`npm login`, with an account that owns the `@zjaaal` scope), from a clean checkout of `main`: `pnpm install --frozen-lockfile && pnpm run test:all && pnpm run build && npm publish --access public`. This creates `@zjaaal/artemis@0.1.0`. (Provenance is not available for a local publish; later releases get it.)
2. On npmjs.com open the package, Settings, Trusted Publisher, choose GitHub Actions and enter: owner `zJaaal`, repository `artemis`, workflow filename `release.yml`, no environment. Save.
3. For each later release: bump `version` in `package.json`, commit, `git tag vX.Y.Z`, `git push origin main vX.Y.Z`. The workflow tests, builds and publishes with provenance.
4. Optionally, once the trusted publisher works, set the package to require 2FA and disallow tokens.

## Development

```sh
pnpm install
pnpm run test:all   # tsc, eslint, prettier, vitest (including the type tests)
pnpm run build      # emits dist/ (JS and .d.ts)
```

The code follows [docs/CODE_STANDARDS.md](docs/CODE_STANDARDS.md). Changes are specified in `specs/`.

## License

MIT
