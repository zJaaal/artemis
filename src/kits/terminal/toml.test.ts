import { describe, expect, test } from 'vitest';

import type { TerminalTab } from './models.js';
import { toToml } from './toml.js';

const plain = { id: 'demo', name: 'demo', panes: [{ dir: '/work/demo' }] } satisfies TerminalTab;

const titled = { ...plain, title: 'Demo' } satisfies TerminalTab;

describe('toToml', () => {
    test('the same tab always gives the same text', () => {
        expect(toToml(plain)).toBe(toToml(plain));
    });

    test('a tab ends with a newline', () => {
        expect(toToml(plain).endsWith('\n')).toBe(true);
    });

    test('a title is written only when the tab has one', () => {
        expect(toToml(plain)).not.toMatch(/^title/m);
    });

    test('a title is written when the tab has one', () => {
        expect(toToml(titled)).toMatch(/^title = "Demo"$/m);
    });

    test('a pane with no commands has no commands line', () => {
        expect(toToml(plain)).not.toMatch(/commands/);
    });

    test('a pane that is not focused has no focus line', () => {
        expect(toToml(plain)).not.toMatch(/is_focused/);
    });

    test('a single pane is the root pane', () => {
        expect(toToml(plain)).toMatch(/\[\[panes\]\]\nid = "pane_1"\ntype = "terminal"/);
    });
});
