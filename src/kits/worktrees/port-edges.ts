import { spawnSync } from 'node:child_process';

import { PORT_PROBE_SCRIPT, PORT_PROBE_TIMEOUT_MS, PROBE_OUTPUT_SEPARATOR } from './constants.js';
import type { PortProbeEdges, PortsInUseFn } from './models.js';

// Edge: the default `portsInUse`. `ensure` runs inside the registry's synchronous lock, so it cannot
// use `net` (asynchronous) directly: a short child process listens on each port and says which ones
// are taken. This is not port scanning: nothing connects to any host.

const REAL_EDGES: PortProbeEdges = {
    spawn: (command, args, timeoutMs) => {
        const result = spawnSync(command, args, { timeout: timeoutMs, encoding: 'utf8' });

        return { status: result.status, stdout: result.stdout, failed: result.error !== undefined };
    },
    now: () => Date.now(),
    execPath: process.execPath
};

/** The ports a probe printed; a line that is not a port is ignored. */
const readPorts = (stdout: string): Set<number> =>
    new Set(
        stdout
            .split(PROBE_OUTPUT_SEPARATOR)
            .map((line) => Number(line))
            .filter((port) => Number.isInteger(port) && port > 0)
    );

/**
 * A probe for one `ensure`. All of its calls share a single deadline, `PORT_PROBE_TIMEOUT_MS`: it
 * runs while the registry lock is held, so the lock is held for probing for at most that long, below
 * the store's lock timeout, however many slots are blocked. Each child's timeout is what is left of
 * it, and once it is spent the remaining candidates count as free.
 *
 * It fails open: a child that cannot start, times out, exits non-zero or prints something unreadable
 * means "nothing in use". The check is advice, and an `ensure` that refused to work because the probe
 * broke would cost more than the clash it guards against; Docker still names the port.
 */
export const createPortProbe = (
    edges: PortProbeEdges = REAL_EDGES,
    budgetMs: number = PORT_PROBE_TIMEOUT_MS
): PortsInUseFn => {
    const deadline = edges.now() + budgetMs;

    return (ports) => {
        const left = deadline - edges.now();

        if (left <= 0 || !ports.length) {
            return new Set();
        }

        const result = edges.spawn(
            edges.execPath,
            ['-e', PORT_PROBE_SCRIPT, ...ports.map(String)],
            left
        );

        return result.failed || result.status !== 0 ? new Set() : readPorts(result.stdout);
    };
};
