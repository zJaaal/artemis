import { gitRoot } from './git.js';
import { workingDirectory } from '../../edges/system.js';
import { CommandError } from '../../errors/errors.js';
import { MAIN_SLOT } from './constants.js';
import type { CurrentOptions, KitConfig, WorktreeInstance } from './models.js';
import { describeInstance } from './instances.js';

/** The instance pinned by the app's env variable, if the app has one and it is set. */
export const pinnedName = ({ envVar, env }: KitConfig): string | undefined =>
    envVar ? env[envVar] || undefined : undefined;

export const noInstanceError = (name: string): CommandError =>
    new CommandError(`There is no instance named "${name}".`, {
        hint: 'Registered instances are listed by the app; a worktree registers on its first start.'
    });

/** The main checkout is slot 0 and needs no registration. */
export const mainInstance = (config: KitConfig): WorktreeInstance =>
    describeInstance(config, config.mainName, { slot: MAIN_SLOT, root: config.mainRoot });

/** Every instance: the main one first, then the registered worktrees by slot. */
export function listInstances(config: KitConfig): WorktreeInstance[] {
    const registered = Object.entries(config.store.read())
        .map(([name, record]) => describeInstance(config, name, record))
        .sort((a, b) => a.slot - b.slot);

    return [mainInstance(config), ...registered];
}

export function getInstance(config: KitConfig, name: string): WorktreeInstance {
    const found = listInstances(config).find((instance) => instance.name === name);

    if (!found) {
        throw noInstanceError(name);
    }

    return found;
}

/** The checkout root containing `cwd`, or null when it is not a checkout of this app. */
export function rootOf(config: KitConfig, cwd: string): string | null {
    const root = gitRoot(cwd);

    return root && config.isCheckout(root) ? root : null;
}

/** The instance of a checkout root: the main one, or the registered worktree there. */
export function instanceAt(config: KitConfig, root: string): WorktreeInstance | undefined {
    if (root === config.mainRoot) {
        return mainInstance(config);
    }

    return listInstances(config).find((instance) => !instance.isMain && instance.root === root);
}

const unregisteredHint = (envVar: string | undefined): string =>
    `Register it first (the app's start command does that)${envVar ? `, or set ${envVar} to use another instance` : ''}.`;

/**
 * The instance for where the app runs: the env variable's if set; else the checkout containing
 * `cwd` (main -> main, registered -> its instance); outside any checkout, main. A worktree that
 * is not registered throws, so nothing lands on another worktree's instance by mistake.
 */
export function currentInstance(
    config: KitConfig,
    { cwd = workingDirectory() }: CurrentOptions = {}
): WorktreeInstance {
    const pinned = pinnedName(config);

    if (pinned) {
        return getInstance(config, pinned);
    }

    const root = rootOf(config, cwd);

    if (!root) {
        return mainInstance(config);
    }

    const found = instanceAt(config, root);

    if (!found) {
        throw new CommandError(`${root} is a worktree with no instance yet.`, {
            hint: unregisteredHint(config.envVar)
        });
    }

    return found;
}
