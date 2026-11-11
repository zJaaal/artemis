#!/usr/bin/env node
// The global `artemis` binary. Wiring only: the logic is in main.ts and locate.ts.
import { register } from 'node:module';

import { main } from './main.js';

// Command files import the framework by its package name; see resolve-hook.ts.
register('./resolve-hook.js', import.meta.url);

process.exitCode = await main(process.argv.slice(2));
