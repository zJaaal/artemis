import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createTempFolders } from '../../test/temp.js';
import type { TerminalTab } from './models.js';
import { openTabs } from './open-tabs.js';
import { warp } from './warp.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

const demoTab: TerminalTab = {
    id: 'demo_dotcms',
    name: 'demo: dotCMS',
    title: 'demo dotCMS',
    color: 'green',
    panes: [
        { dir: '/work/demo', run: ['art dotcms up'] },
        { dir: '/work/demo', run: ['art dotcms wait'], focus: true }
    ]
};

const nestedTab: TerminalTab = {
    id: 'nested',
    name: 'nested',
    layout: {
        split: 'vertical',
        children: [
            {
                split: 'horizontal',
                children: [
                    { dir: '/w/core-web', run: ['serve'] },
                    { dir: '/w', run: ['up'] }
                ]
            },
            { dir: '/w', run: ['wait'], focus: true }
        ]
    }
};

/** Writes `tab` with a Warp adapter in a temporary folder and returns the Tab Config it wrote. */
const writeTab = (tab: TerminalTab): string => {
    const configDir = folders.make('artemis-warp-');

    warp({ configDir, open: () => undefined }).write(tab);

    return fs.readFileSync(path.join(configDir, `${tab.id}.toml`), 'utf8');
};

describe('the warp adapter', () => {
    test('writes a Tab Config named after the tab, with its color', () => {
        const toml = writeTab(demoTab);

        expect(toml).toMatch(/^name = "demo: dotCMS"$/m);
        expect(toml).toMatch(/^color = "green"$/m);
    });

    test('splits a flat list of panes left to right', () => {
        expect(writeTab(demoTab)).toMatch(
            /split = "horizontal"\nchildren = \["pane_1", "pane_2"\]/
        );
    });

    test('writes the commands and the focus of a pane', () => {
        expect(writeTab(demoTab)).toMatch(
            /directory = "\/work\/demo"\ncommands = \["art dotcms wait"\]\nis_focused = true/
        );
    });

    test('opens a tab through its warp:// link, by id', () => {
        const opened: string[] = [];
        const configDir = folders.make('artemis-warp-');

        openTabs(warp({ configDir, open: (url) => opened.push(url) }), [demoTab]);

        expect(opened).toEqual(['warp://tab_config/demo_dotcms']);
    });

    test('writes every tab before it opens any', () => {
        const configDir = folders.make('artemis-warp-');
        const seen: boolean[] = [];
        const second: TerminalTab = { id: 'second', name: 'second', panes: [{ dir: '/x' }] };

        openTabs(
            warp({
                configDir,
                open: () => seen.push(fs.existsSync(path.join(configDir, 'second.toml')))
            }),
            [demoTab, second]
        );

        expect(seen).toEqual([true, true]);
    });

    test('a single-pane tab has no split node', () => {
        expect(writeTab({ id: 'solo', name: 'solo', panes: [{ dir: '/x' }] })).not.toMatch(/split/);
    });

    test('remove deletes the Tab Config', () => {
        const configDir = folders.make('artemis-warp-');
        const terminal = warp({ configDir, open: () => undefined });

        terminal.write({ id: 'solo', name: 'solo', panes: [{ dir: '/x' }] });
        terminal.remove('solo');

        expect(fs.existsSync(path.join(configDir, 'solo.toml'))).toBe(false);
    });

    test('removing a Tab Config that is not there is not an error', () => {
        const terminal = warp({ configDir: folders.make('artemis-warp-'), open: () => undefined });

        expect(() => terminal.remove('never-written')).not.toThrow();
    });

    test('creates the config folder when it does not exist yet', () => {
        const configDir = path.join(folders.make('artemis-warp-'), 'a', 'b');

        warp({ configDir, open: () => undefined }).write(demoTab);

        expect(fs.existsSync(path.join(configDir, 'demo_dotcms.toml'))).toBe(true);
    });
});

describe('the warp adapter: layout trees', () => {
    test('the root comes first', () => {
        const ids = [...writeTab(nestedTab).matchAll(/^id = "([^"]+)"$/gm)].map(
            (match) => match[1]
        );

        expect(ids[0]).toBe('root');
    });

    test('a layout tree nests splits: two panes on top, one across the bottom', () => {
        const toml = writeTab(nestedTab);

        expect(toml).toMatch(/id = "root"\nsplit = "vertical"\nchildren = \["split_1", "pane_3"\]/);

        expect(toml).toMatch(
            /id = "split_1"\nsplit = "horizontal"\nchildren = \["pane_1", "pane_2"\]/
        );
    });

    test('a pane inside a split keeps its directory and commands', () => {
        expect(writeTab(nestedTab)).toMatch(
            /id = "pane_1"\ntype = "terminal"\ndirectory = "\/w\/core-web"\ncommands = \["serve"\]/
        );
    });

    test('the focused pane of a layout is marked', () => {
        expect(writeTab(nestedTab)).toMatch(
            /id = "pane_3"\ntype = "terminal"\ndirectory = "\/w"\ncommands = \["wait"\]\nis_focused = true/
        );
    });

    test('a layout that is a single pane needs no split node', () => {
        expect(writeTab({ id: 'one', name: 'one', layout: { dir: '/x', run: ['a'] } })).not.toMatch(
            /split/
        );
    });

    test('paths and commands are written as escaped TOML strings', () => {
        const toml = writeTab({
            id: 'quoted',
            name: 'quoted',
            panes: [{ dir: '/work/my "app"', run: ['echo "hi"'] }]
        });

        expect(toml).toContain('directory = "/work/my \\"app\\""');
    });
});
