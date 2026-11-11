// Types of the terminal kit: no type lives in a logic file.

/** One terminal pane: a folder, the commands to type in it, and whether it takes focus. */
export type TerminalPane = { dir: string; run?: readonly string[]; focus?: boolean };

/** `horizontal` puts children side by side, `vertical` stacks them. */
export type SplitDirection = 'horizontal' | 'vertical';

export type TerminalSplit = { split: SplitDirection; children: readonly TerminalLayout[] };

export type TerminalLayout = TerminalPane | TerminalSplit;

type TabBase = { id: string; name: string; title?: string; color?: string };

/** A tab is either a flat list of panes (left to right) or a layout tree of splits. */
export type TerminalTab =
    | (TabBase & { panes: readonly TerminalPane[]; layout?: never })
    | (TabBase & { layout: TerminalLayout; panes?: never });

/** What an adapter does with a tab: write its config, open it, remove it. */
export type Terminal = {
    write: (tab: TerminalTab) => void;
    open: (id: string) => void;
    remove: (id: string) => void;
};

export type OpenLinkFn = (url: string) => void;

export type WarpOptions = {
    /** Where Warp reads Tab Configs from. Default: `~/.warp/tab_configs`. */
    configDir?: string;
    /** How a link is opened. Default: macOS `open`. */
    open?: OpenLinkFn;
};

export type WarpFn = (options?: WarpOptions) => Terminal;
export type OpenTabsFn = (terminal: Terminal, tabs: readonly TerminalTab[]) => void;

/** A pane or split with the id Warp refers to it by. */
export type IdentifiedNode =
    | (TerminalPane & { id: string })
    | { split: SplitDirection; id: string; children: IdentifiedNode[] };

export type IdCounters = { pane: number; split: number };

export type ToTomlFn = (tab: TerminalTab) => string;
