import { AsyncLocalStorage } from 'node:async_hooks';

import type { WorkScope } from './models.js';

const scopes = new AsyncLocalStorage<readonly WorkScope[]>();

/** Runs `work` in a scope of its own: everything it starts, however late, belongs to that scope. */
export const runInWorkScope = <TResult>(scope: WorkScope, work: () => TResult): TResult =>
    scopes.run([...(scopes.getStore() ?? []), scope], work);

/**
 * Whether the code running now was started by document work that was refused for returning a
 * promise. That work keeps running after its lock is gone, so whatever it writes, through any
 * document, would land outside the lock. Flows that never were inside such work are not affected.
 */
export const isAbandonedHere = (): boolean =>
    (scopes.getStore() ?? []).some((scope) => scope.abandoned);
