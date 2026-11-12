import { currentProcess } from '../../edges/process.js';
import {
    DEFAULT_COLORS,
    DEFAULT_MAIN_NAME,
    DEFAULT_MAX_SLOTS,
    DEFAULT_SLOT_STEP
} from './constants.js';
import { createPortProbe } from './port-edges.js';
import { findPortProblems } from './ports.js';
import { realPathOrResolve } from '../../edges/files.js';
import type {
    DefineWorktreesFn,
    IsCheckoutFn,
    KitConfig,
    Operation,
    WorktreesOptions
} from './models.js';
import { ensureDetachedInstance, ensureInstance, removeInstance } from './registration.js';
import { currentInstance, getInstance, listInstances } from './queries.js';

const everyFolderIsACheckout: IsCheckoutFn = () => true;

/** Refuses a port plan that cannot work, with one TypeError that names the options and keys. */
function assertPortPlan(config: KitConfig): void {
    const problems = findPortProblems(config);

    if (problems.length) {
        throw new TypeError(`defineWorktrees: ${problems.join('\n')}`);
    }
}

/** The options with their defaults applied. */
function configure(options: WorktreesOptions): KitConfig {
    return {
        registry: options.registry,
        mainRoot: realPathOrResolve(options.mainCheckout),
        ports: options.ports,
        isCheckout: options.isCheckout ?? everyFolderIsACheckout,
        envVar: options.envVar,
        slotStep: options.slotStep ?? DEFAULT_SLOT_STEP,
        maxSlots: options.maxSlots ?? DEFAULT_MAX_SLOTS,
        newProbe: () => options.portsInUse ?? createPortProbe(),
        colors: options.colors ?? DEFAULT_COLORS,
        mainName: options.mainName ?? DEFAULT_MAIN_NAME,
        env: options.env ?? currentProcess().env
    };
}

/** Every write to the registry happens under its lock; reading needs none. */
function locked<TArgs extends unknown[], TResult>(
    config: KitConfig,
    operation: Operation<TArgs, TResult>
): Operation<TArgs, TResult> {
    return (...args) => config.registry.locked(() => operation(...args));
}

/**
 * Artemis worktrees kit: give every checkout of a repo its own instance (a stable slot, ports
 * shifted by that slot, a color) so several copies of an app can run side by side.
 *
 * Every checkout is a worktree, the main one included. The main checkout is slot 0 and needs no
 * registration; other worktrees register on first use (ensure) and keep their slot until removed.
 * The kit stores nothing of its own: the app hands it the document the registry lives in.
 */
export const defineWorktrees: DefineWorktreesFn = (options) => {
    const config = configure(options);

    assertPortPlan(config);

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
