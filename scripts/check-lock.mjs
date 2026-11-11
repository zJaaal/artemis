// Run after `pnpm run build`. Races real processes against the built kits. Registrations: each
// process registers its own instance at the same moment, and every one must get its own slot.
// Documents: processes update one counter, and none may be lost. Named locks: processes do a slow
// read-modify-write under one lock, and none may be lost either.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROCESSES = 12;
const ROUNDS = 5;
const COUNTER_PROCESSES = 2;
const COUNTER_UPDATES = 50;
const LOCKED_PROCESSES = 6;
const LOCKED_ROUNDS = 5;
const SLOW_WORK_MS = 5;

const worktrees = pathToFileURL(path.resolve('dist/kits/worktrees/index.js')).href;
const storeKit = pathToFileURL(path.resolve('dist/kits/store/index.js')).href;

/** Runs a module script in its own process; resolves when it exits cleanly. */
const inChild = (source) =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
            stdio: ['ignore', 'ignore', 'pipe']
        });

        let stderr = '';

        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
    });

const registerInChild = (folder, name) =>
    inChild(`import { defineStore } from ${JSON.stringify(storeKit)};
             import { defineWorktrees } from ${JSON.stringify(worktrees)};
             const registry = defineStore({ dir: ${JSON.stringify(path.join(folder, 'state'))} })
                 .doc('worktrees', { fallback: {} });
             defineWorktrees({ registry, mainCheckout: ${JSON.stringify(folder)}, ports: { http: 8080 } })
                 .ensureDetached({ name: ${JSON.stringify(name)} });`);

const countInChild = (dir) =>
    inChild(`import { defineStore } from ${JSON.stringify(storeKit)};
             const counter = defineStore({ dir: ${JSON.stringify(dir)} }).doc('counter', { fallback: { count: 0 } });
             for (let index = 0; index < ${COUNTER_UPDATES}; index++) {
                 counter.update((current) => ({ count: current.count + 1 }));
             }`);

const lockedCountInChild = (dir) =>
    inChild(`import { setTimeout as sleep } from 'node:timers/promises';
             import { defineStore } from ${JSON.stringify(storeKit)};
             const store = defineStore({ dir: ${JSON.stringify(dir)} });
             const counter = store.doc('counter', { fallback: { count: 0 } });
             for (let index = 0; index < ${LOCKED_ROUNDS}; index++) {
                 await store.lock('build', async () => {
                     const seen = counter.read().count;

                     await sleep(${SLOW_WORK_MS});
                     counter.write({ count: seen + 1 });
                 });
             }`);

const withFolder = async (work) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-lock-'));

    try {
        await work(folder);
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
};

const race = (round) =>
    withFolder(async (folder) => {
        const stateFile = path.join(folder, 'state', 'worktrees.json');
        const names = Array.from({ length: PROCESSES }, (_, index) => `racer-${round}-${index}`);

        await Promise.all(names.map((name) => registerInChild(folder, name)));

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
    });

const countRace = () =>
    withFolder(async (folder) => {
        await Promise.all(Array.from({ length: COUNTER_PROCESSES }, () => countInChild(folder)));

        const { count } = JSON.parse(fs.readFileSync(path.join(folder, 'counter.json'), 'utf8'));

        assert.equal(count, COUNTER_PROCESSES * COUNTER_UPDATES, 'no update was lost');
        assert.deepEqual(fs.readdirSync(folder), ['counter.json'], 'nothing is left behind');
    });

const namedLockRace = () =>
    withFolder(async (folder) => {
        await Promise.all(
            Array.from({ length: LOCKED_PROCESSES }, () => lockedCountInChild(folder))
        );

        const { count } = JSON.parse(fs.readFileSync(path.join(folder, 'counter.json'), 'utf8'));

        assert.equal(count, LOCKED_PROCESSES * LOCKED_ROUNDS, 'no slow update was lost');
        assert.deepEqual(fs.readdirSync(folder), ['counter.json'], 'nothing is left behind');
    });

for (let round = 0; round < ROUNDS; round++) {
    await race(round);
}

console.log(`ok   ${ROUNDS} rounds of ${PROCESSES} real processes registering at once`);

await countRace();

console.log(
    `ok   ${COUNTER_PROCESSES} real processes updating one document ${COUNTER_UPDATES} times each: ${COUNTER_PROCESSES * COUNTER_UPDATES}`
);

await namedLockRace();

console.log(
    `ok   ${LOCKED_PROCESSES} real processes doing slow work under one named lock: ${LOCKED_PROCESSES * LOCKED_ROUNDS}`
);
