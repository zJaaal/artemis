import path from 'node:path';

import { pathExists } from '../edges/files.js';
import { createRegistryStore } from '../kits/worktrees/registry-store.js';
import type { KitConfig } from '../kits/worktrees/models.js';
import {
    KIT_BASE_PORTS,
    KIT_COLORS,
    KIT_LOCK_TIMEOUT_MS,
    KIT_SLOT_STEP,
    TEMP_REPO_MARKER
} from './constants.js';
import { createFakeLockEdges } from './lock-edges.js';

/** A worktrees kit configuration over a real registry file in `folder`; a marker folder marks a checkout. */
export const createKitConfig = (
    folder: string,
    mainRoot: string,
    overrides: Partial<KitConfig> = {}
): KitConfig => {
    const stateFile = path.join(folder, 'state', 'worktrees.json');

    const { edges } = createFakeLockEdges({
        isProcessAlive: () => false,
        timeoutMs: KIT_LOCK_TIMEOUT_MS
    });

    return {
        stateFile,
        mainRoot,
        ports: KIT_BASE_PORTS,
        isCheckout: (root) => pathExists(path.join(root, TEMP_REPO_MARKER)),
        envVar: undefined,
        slotStep: KIT_SLOT_STEP,
        colors: KIT_COLORS,
        mainName: 'main',
        env: {},
        store: createRegistryStore(stateFile),
        lock: edges,
        ...overrides
    };
};
