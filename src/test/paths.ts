import path from 'node:path';

/**
 * A POSIX-looking path of a fake file system (`/work/app`) as this platform writes it: on Windows
 * it gets the current drive and backslashes, which is what the code under test returns.
 */
export const at = (posixPath: string): string => path.resolve(posixPath);

/** A text with any characters a regular expression would read as syntax made literal, so a path can go in one. */
export const escapeForRegExp = (text: string): string =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
