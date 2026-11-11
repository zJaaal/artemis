import fs from 'node:fs';
import path from 'node:path';

import type { StateProjectOptions } from './models.js';

/**
 * A project that keeps state: a package.json with an "artemis" key (and `stateDir` when given), and
 * these documents in its state folder. A string is written as it is (so a test can make a corrupt
 * file); anything else is written as JSON. Returns the state folder.
 */
export const makeStateProject = (
    root: string,
    { stateDir, documents = {}, files = {} }: StateProjectOptions = {}
): string => {
    const folder = path.join(root, stateDir ?? 'state');

    fs.mkdirSync(folder, { recursive: true });

    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'project', artemis: stateDir === undefined ? {} : { stateDir } })
    );

    Object.entries(documents).forEach(([name, value]) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 4);

        fs.writeFileSync(path.join(folder, `${name}.json`), text);
    });

    Object.entries(files).forEach(([file, text]) => {
        fs.writeFileSync(path.join(folder, file), text);
    });

    return folder;
};
