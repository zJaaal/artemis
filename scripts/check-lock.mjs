// Run after `pnpm run build`. Races real processes against the built worktrees kit: each one
// registers its own instance at the same moment, and every one must get its own slot.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROCESSES = 12;
const ROUNDS = 5;

const kit = pathToFileURL(path.resolve('dist/kits/worktrees/index.js')).href;

const registerInChild = (stateFile, mainCheckout, name) =>
    new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `import { defineWorktrees } from ${JSON.stringify(kit)};
                 defineWorktrees({ stateFile: ${JSON.stringify(stateFile)}, mainCheckout: ${JSON.stringify(mainCheckout)}, ports: { http: 8080 } })
                     .ensureDetached({ name: ${JSON.stringify(name)} });`
            ],
            { stdio: ['ignore', 'ignore', 'pipe'] }
        );

        let stderr = '';

        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
    });

async function race(round) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-lock-'));
    const stateFile = path.join(folder, 'state', 'worktrees.json');
    const names = Array.from({ length: PROCESSES }, (_, index) => `racer-${round}-${index}`);

    try {
        await Promise.all(names.map((name) => registerInChild(stateFile, folder, name)));

        const records = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        const slots = Object.values(records).map((record) => record.slot);

        assert.deepEqual(
            Object.keys(records).sort(),
            [...names].sort(),
            'every registration survived'
        );

        assert.equal(new Set(slots).size, PROCESSES, 'every instance has its own slot');

        assert.deepEqual(
            fs.readdirSync(path.dirname(stateFile)),
            ['worktrees.json'],
            'no lock, guard or staging file is left behind'
        );
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
}

for (let round = 0; round < ROUNDS; round++) {
    await race(round);
}

console.log(`ok   ${ROUNDS} rounds of ${PROCESSES} real processes registering at once`);
