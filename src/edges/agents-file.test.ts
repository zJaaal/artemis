import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { AGENTS_FILE } from '../constants.js';
import { readAgents } from './agents-file.js';
import { readRunningPackage } from './package-info.js';

describe('readAgents', () => {
    test('reads the AGENTS.md beside the running package, as it is', () => {
        const file = path.join(readRunningPackage().root, AGENTS_FILE);

        expect(readAgents()).toEqual({ file, markdown: fs.readFileSync(file, 'utf8') });
    });
});
