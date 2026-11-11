import { describe, expect, test } from 'vitest';

import type { Terminal, TerminalTab } from './models.js';
import { openTabs } from './open-tabs.js';

const tabs: TerminalTab[] = [
    { id: 'first', name: 'first', panes: [{ dir: '/a' }] },
    { id: 'second', name: 'second', panes: [{ dir: '/b' }] }
];

/** A terminal that only records what it was asked to do. */
const recordingTerminal = (): { terminal: Terminal; calls: string[] } => {
    const calls: string[] = [];

    return {
        calls,
        terminal: {
            write: (tab) => calls.push(`write ${tab.id}`),
            open: (id) => calls.push(`open ${id}`),
            remove: (id) => calls.push(`remove ${id}`)
        }
    };
};

describe('openTabs', () => {
    test('writes every tab before it opens any, in order', () => {
        const { terminal, calls } = recordingTerminal();

        openTabs(terminal, tabs);

        expect(calls).toEqual(['write first', 'write second', 'open first', 'open second']);
    });

    test('with no tabs it does nothing', () => {
        const { terminal, calls } = recordingTerminal();

        openTabs(terminal, []);

        expect(calls).toEqual([]);
    });
});
