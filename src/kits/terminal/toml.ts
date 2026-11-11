import { FIRST_PANE_ID, PANE_ID_PREFIX, ROOT_PANE_ID, SPLIT_ID_PREFIX } from './constants.js';
import type {
    IdCounters,
    IdentifiedNode,
    TerminalLayout,
    TerminalSplit,
    TerminalTab,
    ToTomlFn
} from './models.js';

// TOML basic strings use the same escapes as JSON for what we write (paths and commands)
const str = (value: string): string => JSON.stringify(value);

const isSplit = (node: TerminalLayout): node is TerminalSplit => 'split' in node;

/** A flat list of panes is a left-to-right split; a single pane needs no split at all. */
function layoutOf(tab: TerminalTab): TerminalLayout {
    if (tab.layout) {
        return tab.layout;
    }

    const panes = tab.panes ?? [];
    const [only] = panes;

    return panes.length === 1 && only ? only : { split: 'horizontal', children: panes };
}

/** Assigns Warp pane ids: "root" for the top node, split_N for nested splits, pane_N for panes. */
function assignIds(node: TerminalLayout, counters: IdCounters, isRoot: boolean): IdentifiedNode {
    if (!isSplit(node)) {
        return { ...node, id: isRoot ? FIRST_PANE_ID : `${PANE_ID_PREFIX}${++counters.pane}` };
    }

    const id = isRoot ? ROOT_PANE_ID : `${SPLIT_ID_PREFIX}${++counters.split}`;
    const children = node.children.map((child) => assignIds(child, counters, false));

    return { split: node.split, id, children };
}

// Warp reads the first [[panes]] entry as the root, so nodes go out parent first
function nodeLines(node: IdentifiedNode): string[] {
    const header = ['', '[[panes]]', `id = ${str(node.id)}`];

    if ('children' in node) {
        const ids = node.children.map((child) => str(child.id)).join(', ');

        return [
            ...header,
            `split = ${str(node.split)}`,
            `children = [${ids}]`,
            ...node.children.flatMap(nodeLines)
        ];
    }

    return [
        ...header,
        'type = "terminal"',
        `directory = ${str(node.dir)}`,
        ...(node.run?.length ? [`commands = [${node.run.map(str).join(', ')}]`] : []),
        ...(node.focus ? ['is_focused = true'] : [])
    ];
}

/** The Warp Tab Config (TOML) for a tab. Pure: the same tab always gives the same text. */
export const toToml: ToTomlFn = (tab) => {
    const root = assignIds(layoutOf(tab), { pane: 0, split: 0 }, true);

    const lines = [
        `name = ${str(tab.name)}`,
        ...(tab.title ? [`title = ${str(tab.title)}`] : []),
        ...(tab.color ? [`color = ${str(tab.color)}`] : []),
        ...nodeLines(root)
    ];

    return `${lines.join('\n')}\n`;
};
