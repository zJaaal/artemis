[Back to the README](../../README.md)

# Worktrees: `@zjaaal/artemis/worktrees`

Give every checkout of a repo its own **instance**: a stable slot, ports shifted by that slot, and a color, so several copies of an app can run side by side. The main checkout is slot 0 and needs no registration; other worktrees register on first use and keep their slot until removed. The kit keeps nothing of its own: the app hands it the store document the registry lives in (`registry`).

```js
import { defineStore } from '@zjaaal/artemis/store';
import { defineWorktrees } from '@zjaaal/artemis/worktrees';

const store = defineStore({ project: import.meta.url });

const worktrees = defineWorktrees({
    registry: store.doc('instances', { fallback: {} }),
    mainCheckout: '/path/to/main/checkout',
    ports: { http: 8080, frontend: 4200 }
});

const instance = worktrees.ensure(); // registers the checkout you are in, on first use
instance.ports; // { http: 8180, frontend: 4300 } for slot 1
```

| Option         | What it is                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `registry`     | The store document the registry is kept in: `store.doc('instances', { fallback: {} })` (required).                                               |
| `mainCheckout` | Path of the main checkout, slot 0 (required).                                                                                                    |
| `ports`        | Base ports, shifted by `slot * slotStep` (required).                                                                                             |
| `isCheckout`   | `(root) => boolean`: whether a git root is a checkout of this app. Other repos count as outside any checkout.                                    |
| `envVar`       | A variable that pins the instance by name, overriding the folder.                                                                                |
| `slotStep`     | Port shift per slot. Default `100`.                                                                                                              |
| `maxSlots`     | How many slots there can be, slot 0 included. Default `20`. `ensure` never gives out one past it.                                                |
| `portsInUse`   | `(ports) => Set<number>`: which of these ports are in use on the machine. Default: a short child process. `() => new Set()` turns the check off. |
| `colors`       | One per slot, cycling.                                                                                                                           |
| `mainName`     | Name of the main instance. Default `"main"`.                                                                                                     |

| Method                           | What it does                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `list()`                         | Every instance: the main one first, then the registered ones by slot.                                                                         |
| `get(name)`                      | One instance by name, or a `CommandError`.                                                                                                    |
| `current({ cwd })`               | The instance for where the app runs. A worktree that is not registered refuses, with a hint, so nothing lands on another instance by mistake. |
| `ensure({ cwd, root, name })`    | The instance for a checkout, registering it on first use, named after its folder (with a suffix if taken).                                    |
| `ensureDetached({ name, meta })` | A named instance that belongs to no checkout (for example one per container image).                                                           |
| `remove(name)`                   | Forgets a registered instance and frees its slot. Never touches the worktree itself.                                                          |

`ports` are shifted by `slot * slotStep`, so two bases that are a multiple of `slotStep` apart share a port in two slots: with `elasticsearch: 9200` and `elasticsearchPerf: 9600` at step `100`, slot 4's `elasticsearch` is slot 0's `elasticsearchPerf`. `defineWorktrees` refuses such bases when it is called (with a `TypeError` that lists every pair and names the keys), unless they are `maxSlots` or more slots apart, because then the two slots cannot both exist. It also refuses a port outside `1024` to `49151` in any slot, and a `slotStep` or `maxSlots` that is not a whole number above `0`.

When `ensure` or `ensureDetached` gives out a **new** slot, it skips a slot any of whose ports is already in use on the machine (a local Postgres on 5432, another app): one slot at a time, lowest first, so the numbers can have gaps. It never checks an instance that is already registered. The default check runs one short child process that tries to listen on every interface, as Vite does, and it **fails open**: if it cannot run or times out, nothing counts as in use and the slot is given out (Docker still names the port if there is a clash). All the checks of one `ensure` share a 5 s deadline, because they run while the registry lock is held. Listening on all interfaces can make the macOS application firewall ask "Allow incoming connections?" once, if it is on and the Node binary is not signed; pass `portsInUse: () => new Set()` to turn the check off. Nothing connects to any host: this is the local free-port check every dev server does.

When every slot is registered it fails with "All 19 slots are taken", and when the ones that are not registered each have a port in use it fails with "No free slot below 20: K of them have ports in use" and a hint naming the lowest one and its keys.

Every write to the registry holds the document's lock file (`<dir>/instances.json.lock` for the example above), so several processes registering at once each get their own slot. A lock left by a process that died is taken over safely. How the lock waits (its clock, liveness check and timeout) is set on `defineStore`.
