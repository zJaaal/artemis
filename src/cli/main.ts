#!/usr/bin/env node
// The `art` and `artemis` binary, and what `import '@zjaaal/artemis/cli'` runs. Wiring only: the
// logic is in cli.ts, settings.ts and resolve-hook.ts.
import { register } from 'node:module';

import { cli } from './cli.js';

// Command files import the framework by its package name; see resolve-hook.ts.
register('./resolve-hook.js', import.meta.url);

process.exitCode = await cli(process.argv.slice(2));
