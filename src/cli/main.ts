#!/usr/bin/env node
// The `art` and `artemis` binary. Wiring only: the logic is in launch.ts, settings.ts and resolve-hook.ts.
import { register } from 'node:module';

import { launch } from './launch.js';

// Command files import the framework by its package name; see resolve-hook.ts.
register('./resolve-hook.js', import.meta.url);

process.exitCode = await launch();
