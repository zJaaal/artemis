import type { OpenTabsFn } from './models.js';

/** Writes every tab, then opens them in order. */
export const openTabs: OpenTabsFn = (terminal, tabs) => {
    tabs.forEach((tab) => terminal.write(tab));
    tabs.forEach((tab) => terminal.open(tab.id));
};
