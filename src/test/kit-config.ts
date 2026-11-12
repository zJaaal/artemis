import path from 'node:path';

import { pathExists } from '../edges/files.js';
import { defineStore } from '../kits/store/store.js';
import { DEFAULT_MAX_SLOTS } from '../kits/worktrees/constants.js';
import type { KitConfig } from '../kits/worktrees/models.js';
import {
    KIT_BASE_PORTS,
    KIT_COLORS,
    KIT_LOCK_TIMEOUT_MS,
    KIT_SLOT_STEP,
    TEMP_REPO_MARKER
} from './constants.js';
import { createFakeLockOptions } from './lock-edges.js';

/** A worktrees kit configuration over a real registry file in `folder`; a marker folder marks a checkout. */
export const createKitConfig = (
    folder: string,
    mainRoot: string,
    overrides: Partial<KitConfig> = {}
): KitConfig => {
    const { options } = createFakeLockOptions({
        isProcessAlive: () => false,
        timeoutMs: KIT_LOCK_TIMEOUT_MS
    });

    const registry = defineStore({ dir: path.join(folder, 'state'), ...options }).doc('worktrees', {
        fallback: {}
    });

    return {
        registry,
        mainRoot,
        ports: KIT_BASE_PORTS,
        isCheckout: (root) => pathExists(path.join(root, TEMP_REPO_MARKER)),
        envVar: undefined,
        slotStep: KIT_SLOT_STEP,
        maxSlots: DEFAULT_MAX_SLOTS,
        colors: KIT_COLORS,
        mainName: 'main',
        env: {},
        ...overrides
    };
};
