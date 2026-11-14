[Back to the README](../README.md)

# Fully in control: `run(argv, options)`

A bin file that calls `run()` decides everything itself. `bin` is required: it is the name help and usage lines show.

```js
#!/usr/bin/env node
// bin/art.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '@zjaaal/artemis';

const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../commands');

process.exitCode = await run(process.argv.slice(2), { bin: 'art', commandsDir });
```

`run` resolves to the exit code and **never calls `process.exit`**, so you can embed it and test it.

| Option             | Required | What it is                                                                                                |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| `bin`              | yes      | The name of your CLI, shown in help and usage lines.                                                      |
| `commandsDir`      | yes      | The folder to look for commands in.                                                                       |
| `stdout`, `stderr` | no       | Where output goes (anything with `write(chunk)`; a Node `Writable` fits). Default: the process streams.   |
| `interactive`      | no       | Whether prompts may be shown. Default: stdin and stdout are terminals.                                    |
| `color`            | no       | Default: stdout is a terminal and `NO_COLOR` is unset.                                                    |
| `env`              | no       | The environment to read `NO_COLOR` from. Default: `process.env`.                                          |
| `auditFile`        | no       | Where to append one line per run of a command (the audit trail). Default: nothing is recorded. See below. |

### The audit trail: `auditFile` and `readHistory`

With `auditFile` (an absolute path) `run()` appends one line per run of a resolved project command, after the result is printed: the same lines, with the same rules (what is recorded and what is not, the rotation at 1 MB, a failed write only a warning), as the audit trail of `art` (see [`art history`](cli.md#art-history-what-ran)). Without it nothing is written. `run()` has no `history` word of its own: it owns its bin and its words, so read the trail with `readHistory` and make `history` a command of yours:

```js
import { defineCommand, readHistory } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Show the recorded runs, newest first',
    args: [{ name: 'command', description: 'Only this command id' }],
    run: ({ args }) => readHistory(AUDIT_FILE, { command: args.command, limit: 20 })
});
```

`readHistory(auditFile, { command?, limit? })` returns `{ entries, skipped }`, the same as `art history --json`: the lines of the file, newest first, kept to the command id `command` (an id, not an alias: resolve aliases from your own registry), at most `limit` (default 20). A file that is not there is `{ entries: [], skipped: 0 }`; one that cannot be read throws the `CommandError` `art history` throws; a `limit` that is not a whole number above 0 is a `TypeError`. `AuditLine` is exported as a type.

### Testing your commands

Because `run` takes its world as options, a test passes in-memory sinks and asserts on what was written and on the exit code:

```js
import { run, EXIT_CODE } from '@zjaaal/artemis';

const sink = () => {
    let text = '';

    return {
        write: (chunk) => ((text += chunk), true),
        get text() {
            return text;
        }
    };
};

const stdout = sink();
const code = await run(['math', 'add', '1', '2', '--json'], {
    bin: 'art',
    commandsDir: new URL('../commands', import.meta.url).pathname,
    stdout,
    stderr: sink(),
    interactive: false,
    color: false
});

console.log(code === EXIT_CODE.OK, JSON.parse(stdout.text).result); // true { sum: 3 }
```
