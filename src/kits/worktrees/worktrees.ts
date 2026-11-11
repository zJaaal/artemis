import { currentProcess } from '../../edges/process.js';
import { processId } from '../../edges/system.js';
import { isProcessAlive, now, pause } from './lock-edges.js';
import {
    DEFAULT_COLORS,
    DEFAULT_MAIN_NAME,
    DEFAULT_SLOT_STEP,
    LOCK_TIMEOUT_MS
} from './constants.js';
import { realPathOrResolve } from '../../edges/files.js';
import type {
    DefineWorktreesFn,
    IsCheckoutFn,
    KitConfig,
    Operation,
    WorktreesOptions
} from './models.js';
import { createRegistryStore } from './registry-store.js';
import { withLock } from './lock.js';
import { ensureDetachedInstance, ensureInstance, removeInstance } from './registration.js';
import { currentInstance, getInstance, listInstances } from './queries.js';

const everyFolderIsACheckout: IsCheckoutFn = () => true;

/** The options with their defaults applied, and the registry file they work on. */
function configure(options: WorktreesOptions): KitConfig {
    return {
        stateFile: options.stateFile,
        mainRoot: realPathOrResolve(options.mainCheckout),
        ports: options.ports,
        isCheckout: options.isCheckout ?? everyFolderIsACheckout,
        envVar: options.envVar,
        slotStep: options.slotStep ?? DEFAULT_SLOT_STEP,
        colors: options.colors ?? DEFAULT_COLORS,
        mainName: options.mainName ?? DEFAULT_MAIN_NAME,
        env: options.env ?? currentProcess().env,
        store: createRegistryStore(options.stateFile),
        lock: {
            pid: processId(),
            now: options.now ?? now,
            isProcessAlive: options.isProcessAlive ?? isProcessAlive,
            pause: options.pause ?? pause,
            timeoutMs: options.lockTimeoutMs ?? LOCK_TIMEOUT_MS
        }
    };
}

/** Every write to the registry happens under its lock; reading needs none. */
function locked<TArgs extends unknown[], TResult>(
    config: KitConfig,
    operation: Operation<TArgs, TResult>
): Operation<TArgs, TResult> {
    return (...args) => withLock(config.stateFile, () => operation(...args), config.lock);
}

/**
 * Artemis worktrees kit: give every checkout of a repo its own instance (a stable slot, ports
 * shifted by that slot, a color) so several copies of an app can run side by side.
 *
 * Every checkout is a worktree, the main one included. The main checkout is slot 0 and needs no
 * registration; other worktrees register on first use (ensure) and keep their slot until removed.
 * The kit stores nothing of its own: the app says where the registry lives (stateFile).
 */
export const defineWorktrees: DefineWorktreesFn = (options) => {
    const config = configure(options);

    return {
        list: () => listInstances(config),
        get: (name) => getInstance(config, name),
        current: (currentOptions) => currentInstance(config, currentOptions),
        ensure: locked(config, (ensureOptions) => ensureInstance(config, ensureOptions)),
        ensureDetached: locked(config, (detachedOptions) =>
            ensureDetachedInstance(config, detachedOptions)
        ),
        remove: locked(config, (name) => removeInstance(config, name))
    };
};
