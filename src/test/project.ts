import fs from 'node:fs';
import path from 'node:path';

import type { ProjectOptions } from './models.js';

/** A command file that answers `hello` with the given greeting, like a project's own command. */
const helloCommand = (greeting: string): string => `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Say hello from ${greeting}',
    run: () => ({ greeting: '${greeting}' })
});
`;

/**
 * Creates a project in `root`: a package.json (with any extra fields) and a commands folder with
 * a `hello` command. Returns the commands folder.
 */
export const makeProject = (
    root: string,
    { greeting, manifest = {}, commandsFolder = 'commands' }: ProjectOptions
): string => {
    const commandsDir = path.join(root, commandsFolder);

    fs.mkdirSync(commandsDir, { recursive: true });

    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'project', ...manifest })
    );

    fs.writeFileSync(path.join(commandsDir, 'hello.js'), helloCommand(greeting));

    return commandsDir;
};

/** Writes a command file `<name>.js` into a commands folder, with the given source. */
export const writeCommand = (commandsDir: string, name: string, source: string): void => {
    const file = path.join(commandsDir, `${name}.js`);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
};

/** The source of a command that takes whatever `fields` say (a description and a no-op run are added). */
export const commandSource = (
    fields: string
): string => `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'A command of a test',
    ${fields},
    run: () => ({ done: true })
});
`;
