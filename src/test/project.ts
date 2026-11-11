import fs from 'node:fs';
import path from 'node:path';

import { COMMANDS_FOLDER, PROJECT_FOLDER } from '../global/constants.js';

/** A command file that answers `hello` with the given greeting, like a project's own command. */
const helloCommand = (greeting: string): string => `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Say hello from ${greeting}',
    run: () => ({ greeting: '${greeting}' })
});
`;

/** Creates `<root>/.artemis/commands` with a `hello` command, and returns the commands folder. */
export const makeProject = (root: string, greeting: string): string => {
    const commandsDir = path.join(root, PROJECT_FOLDER, COMMANDS_FOLDER);

    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, 'hello.js'), helloCommand(greeting));

    return commandsDir;
};
