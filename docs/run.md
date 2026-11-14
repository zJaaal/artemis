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

| Option             | Required | What it is                                                                                              |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `bin`              | yes      | The name of your CLI, shown in help and usage lines.                                                    |
| `commandsDir`      | yes      | The folder to look for commands in.                                                                     |
| `stdout`, `stderr` | no       | Where output goes (anything with `write(chunk)`; a Node `Writable` fits). Default: the process streams. |
| `interactive`      | no       | Whether prompts may be shown. Default: stdin and stdout are terminals.                                  |
| `color`            | no       | Default: stdout is a terminal and `NO_COLOR` is unset.                                                  |
| `env`              | no       | The environment to read `NO_COLOR` from. Default: `process.env`.                                        |

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
