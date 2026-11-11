export const WARP_CONFIG_FOLDER = '.warp/tab_configs';
export const WARP_LINK_PREFIX = 'warp://tab_config/';
export const TAB_CONFIG_EXTENSION = '.toml';
export const OPEN_COMMAND = 'open';
export const ROOT_PANE_ID = 'root';
export const FIRST_PANE_ID = 'pane_1';
export const PANE_ID_PREFIX = 'pane_';
export const SPLIT_ID_PREFIX = 'split_';

/** A tab id becomes a file name and part of a link, so it is a plain word: no slashes, spaces or `#`. */
export const TAB_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
