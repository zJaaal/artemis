[Back to the README](../../README.md)

# Store: `@zjaaal/artemis/store`

Safe, versioned JSON documents an app can keep between runs, and a lock for work that takes minutes. The kit models nobody's state: the app picks the folder, the names, the shapes and the defaults. The kit only guarantees **how a file is read and written**: atomically (a temporary file renamed into place, so a crash never leaves half a file), under a lock (so two processes updating at once cannot lose a write), with one clear error for a corrupt file.

```js
import { defineStore } from '@zjaaal/artemis/store';

const store = defineStore({ project: import.meta.url }); // the project's "artemis".stateDir (default "state")
const flags = store.doc('feature-flags', { fallback: { beta: false } });

flags.read(); // { beta: false } until something is written; always a fresh copy
flags.update((current) => ({ ...current, beta: true })); // read, change and write as one step under the lock
```

**Where the files go.** `defineStore({ project: import.meta.url })` uses `"artemis": { "stateDir" }` of the project that file belongs to, which is also what `art state` reads, so the app and the CLI cannot disagree. **`stateDir` and `project` are relative to the project root, but `defineStore({ dir })` is relative to the current folder**, so a relative `dir` moves with wherever the user runs the command. Use `project`, or build an absolute `dir` from `import.meta.url`. `project` takes `import.meta.url` or an absolute path or URL; a relative string is a `TypeError`, because it would be read from the current folder. A published tool installed globally has no project of the user's to find: it passes `dir` itself.

A document is `<dir>/<name>.json`. A name is lowercase letters, digits and dashes (at most 64), anything else is a `TypeError`.

| `doc` method     | What it does                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read()`         | The document, with no lock. The `fallback` when the file does not exist: always a copy, so changing it changes nothing. Upgrades are applied in memory and never written. |
| `write(value)`   | Replaces the document, atomically, under the lock.                                                                                                                        |
| `update(change)` | `change(current)` returns the new value; read, change and write happen as one step under the lock. Returning `undefined` is a `TypeError` (a forgotten `return`).         |
| `locked(work)`   | Holds the lock for a read-modify-write that may write nothing. `work(doc)` can call `doc.write` and `doc.update`: the lock is reentrant inside one process.               |
| `reset()`        | Deletes the file, so the next read returns the fallback.                                                                                                                  |

`locked` and `update` take **synchronous work only**: a function that returns a promise is a `TypeError`, because the lock would be released before it settled. Long or async work goes in `store.lock`. Promise work that was refused is fenced off: a `write`, `update`, `locked` or `reset` called from it after the refusal throws, through any document, so it cannot write later. A write it made before its first `await` ran inside the lock and stays.

**Versions.** A document is plain JSON (version 0) unless it says otherwise, so every file you have today works as it is. From version 1 on the file is `{ "$version": n, "data": ... }`, and you give the steps that bring an older file up:

```js
const steps = store.doc('steps', {
    fallback: { order: [] },
    version: 2,
    upgrades: {
        1: (v0) => ({ order: v0.list ?? [] }), // keyed by the version each one produces
        2: (v1) => ({ ...v1, enabled: true })
    }
});
```

A file older than the code is upgraded in memory, one step at a time (a missing step is a `TypeError` when the document is defined). A file **newer** than the code is a `CommandError` with a hint, never a silent downgrade. A version-0 document whose value happens to be an object with a `"$version"` key is read as versioned: that key is Artemis's.

**Named locks, for long work.** `store.lock(name, work, { onWait, pollMs, timeoutMs, label })` runs `work` (sync or async) while holding `<dir>/<name>.lock`, waiting without blocking the process. `onWait({ pid, label })` is called once, when the lock is first found taken. `label` says what the holder is doing (`'build of core-feat-x'`: one line, at most 120 characters, anything else is a `TypeError`), so whoever waits, and the "is locked" error ("... is locked by process 80676 (build of core-feat-x)."), can name the job and not only the process. Document locks have no label. A lock left by a process that died is taken over. Concurrent calls queue, in one process as across processes: `Promise.all([store.lock('build', a), store.lock('build', b)])` runs `a` then `b`. It is not reentrant: a call made from inside the work that holds the lock (even after an `await`) is a `CommandError` at once, not an endless wait.

```js
await store.lock(
    'build',
    async () => {
        await runTheBuild();
    },
    {
        label: 'build of core-feat-x',
        onWait: ({ pid, label }) => console.log(`waiting for ${label ?? `process ${pid}`}...`)
    }
);
```

**Corrupt files.** A document that is not valid JSON is a `CommandError` naming the file, with a hint to fix or delete it. `art state <doc> --reset` is how.

**In tests.** `createMemoryStore({ documents })` has the same API and never touches the disk. It holds JSON text, so copies and errors behave as on disk, and `documents` is what is "on disk" at the start (a versioned document is given wrapped).

```js
import { createMemoryStore } from '@zjaaal/artemis/store';

const store = createMemoryStore({ documents: { 'feature-flags': { beta: true } } });
```

Lock options (`now`, `isProcessAlive`, `pause`, `sleep`, `lockTimeoutMs`) go to `defineStore` so a test never sleeps. The memory store's named locks honor `onWait`, `pollMs` and `timeoutMs` like the disk store's, and take `now` and `sleep`: `createMemoryStore({ now, sleep })` lets a test of a "waiting for..." or a timeout path run without waiting.
