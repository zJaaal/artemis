import path from 'node:path';

import { commandSource, writeCommand } from './project.js';
import type { GeneratedTree } from './models.js';

/**
 * Writes a tree of command files into `dir`: `topics` topics, each with `perTopic` commands and
 * `nestedPerTopic` more under a nested topic `sub`, and `topLevel` commands in no topic. The tree
 * is built in the test, so a project of 200 commands is never 200 committed files.
 */
export function writeGeneratedCommands(dir: string, tree: GeneratedTree): number {
    const topicIds = Array.from({ length: tree.topics }, (_, index) => `topic${index}`);

    topicIds.forEach((topic) => {
        writeCommand(dir, `${topic}/_topic`, topicSource(`Commands of ${topic}`));
        writeCommand(dir, `${topic}/sub/_topic`, topicSource(`Nested commands of ${topic}`));

        Array.from({ length: tree.perTopic }, (_, index) => index).forEach((index) =>
            writeCommand(dir, `${topic}/run${index}`, commandSource('args: []'))
        );

        Array.from({ length: tree.nestedPerTopic }, (_, index) => index).forEach((index) =>
            writeCommand(dir, path.join(topic, 'sub', `run${index}`), commandSource('args: []'))
        );
    });

    Array.from({ length: tree.topLevel }, (_, index) => index).forEach((index) =>
        writeCommand(dir, `top${index}`, commandSource('args: []'))
    );

    return tree.topics * (tree.perTopic + tree.nestedPerTopic) + tree.topLevel;
}

const topicSource = (description: string): string => `import { defineTopic } from '@zjaaal/artemis';

export default defineTopic({ description: ${JSON.stringify(description)} });
`;
