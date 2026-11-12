import net from 'node:net';

import { afterEach, describe, expect, test } from 'vitest';

import { PORT_PROBE_TIMEOUT_MS } from './constants.js';
import type { PortProbeEdges } from './models.js';
import { createPortProbe } from './port-edges.js';

const servers: net.Server[] = [];

afterEach(async () => {
    await Promise.all(
        servers
            .splice(0)
            .map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
});

/** A server holding a free port on every interface, so the port is really in use. */
const holdPort = (host: string): Promise<number> =>
    new Promise((resolve, reject) => {
        const server = net.createServer();

        servers.push(server);
        server.once('error', reject);
        server.listen({ port: 0, host }, () => resolve((server.address() as net.AddressInfo).port));
    });

/** A port nothing holds right now: ask the OS for one and give it back. */
const freePort = async (): Promise<number> => {
    const server = net.createServer();

    await new Promise<void>((resolve) => server.listen({ port: 0, host: '0.0.0.0' }, resolve));

    const { port } = server.address() as net.AddressInfo;

    await new Promise<void>((resolve) => server.close(() => resolve()));

    return port;
};

describe('createPortProbe: with real children', () => {
    test('a port held by a server on 0.0.0.0 is reported in use', async () => {
        const port = await holdPort('0.0.0.0');

        expect(createPortProbe()([port])).toEqual(new Set([port]));
    });

    test('a free port is not', async () => {
        expect(createPortProbe()([await freePort()])).toEqual(new Set());
    });

    test('only the ports in use come back', async () => {
        const [held, free] = [await holdPort('0.0.0.0'), await freePort()];

        expect(createPortProbe()([held, free])).toEqual(new Set([held]));
    });

    test('the probe leaves nothing listening: the port can be taken right after', async () => {
        const port = await freePort();

        createPortProbe()([port]);

        await expect(holdPort('0.0.0.0').then(() => true)).resolves.toBe(true);
        expect(await freePort()).toBeGreaterThan(0);
    });

    test('no ports is nothing in use, without starting a child', () => {
        expect(createPortProbe()([])).toEqual(new Set());
    });
});

describe('createPortProbe: it fails open', () => {
    const edges = (overrides: Partial<PortProbeEdges> = {}): PortProbeEdges => ({
        spawn: () => ({ status: 0, stdout: '', failed: false }),
        now: () => 0,
        execPath: process.execPath,
        ...overrides
    });

    test('a child that cannot start counts as nothing in use', () => {
        const probe = createPortProbe(
            edges({ spawn: () => ({ status: null, stdout: '', failed: true }) })
        );

        expect(probe([8080])).toEqual(new Set());
    });

    test('a child that exits non-zero counts as nothing in use, whatever it printed', () => {
        const probe = createPortProbe(
            edges({ spawn: () => ({ status: 1, stdout: '8080', failed: false }) })
        );

        expect(probe([8080])).toEqual(new Set());
    });

    test('a child that timed out (no status) counts as nothing in use', () => {
        const probe = createPortProbe(
            edges({ spawn: () => ({ status: null, stdout: '8080', failed: false }) })
        );

        expect(probe([8080])).toEqual(new Set());
    });

    test('output that is not ports is ignored', () => {
        const probe = createPortProbe(
            edges({ spawn: () => ({ status: 0, stdout: 'oops\n8080\n', failed: false }) })
        );

        expect(probe([8080])).toEqual(new Set([8080]));
    });

    test('a bad executable through the real edge counts as nothing in use', () => {
        const probe = createPortProbe({
            ...edges(),
            execPath: 'artemis-no-such-node',
            spawn: (command, args, timeoutMs) => {
                // the real edge, only with the executable the test chose
                return REAL_SPAWN(command, args, timeoutMs);
            }
        });

        expect(probe([8080])).toEqual(new Set());
    });
});

describe('createPortProbe: the shared deadline', () => {
    test('each child gets what is left of the deadline as its timeout', () => {
        const timeouts: number[] = [];
        let clock = 0;

        const probe = createPortProbe({
            spawn: (_command, _args, timeoutMs) => {
                timeouts.push(timeoutMs);
                clock += 1000;

                return { status: 0, stdout: '', failed: false };
            },
            now: () => clock,
            execPath: process.execPath
        });

        probe([1]);
        probe([2]);

        expect(timeouts).toEqual([PORT_PROBE_TIMEOUT_MS, PORT_PROBE_TIMEOUT_MS - 1000]);
    });

    test('once it is spent the rest count as free, and no child is started', () => {
        let started = 0;
        let clock = 0;

        const probe = createPortProbe({
            spawn: () => {
                started++;
                clock += PORT_PROBE_TIMEOUT_MS;

                return { status: 0, stdout: '8080', failed: false };
            },
            now: () => clock,
            execPath: process.execPath
        });

        probe([8080]);

        expect([probe([8080]), started]).toEqual([new Set(), 1]);
    });
});

import { spawnSync } from 'node:child_process';

const REAL_SPAWN: PortProbeEdges['spawn'] = (command, args, timeoutMs) => {
    const result = spawnSync(command, [...args], { timeout: timeoutMs, encoding: 'utf8' });

    return { status: result.status, stdout: result.stdout, failed: result.error !== undefined };
};
