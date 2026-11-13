import path from 'node:path';

import { commandSource, writeCommand } from './project.js';
import type { GeneratedTree } from './models.js';

/**
 * Writes a tree of command files into `dir`: `topics` topics, each with `perTopic` commands and
 * `nestedPerTopic` more under a nested topic `sub`, and `topLevel` commands in no topic. The tree
 * is built in the test, so a project of 200 commands is never 200 committed files.
 */
export function writeGeneratedCommands(dir: string, tree: GeneratedTree): number {
    const count = (length: number): number[] => Array.from({ length }, (_, index) => index);
    const topicIds = count(tree.topics).map((index) => `topic${index}`);

    const files = [
        ...topicIds.flatMap((topic) => [
            [`${topic}/_topic`, topicSource(`Commands of ${topic}`)],
            [`${topic}/sub/_topic`, topicSource(`Nested commands of ${topic}`)],
            ...count(tree.perTopic).map((index) => [
                `${topic}/run${index}`,
                commandSource('args: []')
            ]),
            ...count(tree.nestedPerTopic).map((index) => [
                path.join(topic, 'sub', `run${index}`),
                commandSource('args: []')
            ])
        ]),
        ...count(tree.topLevel).map((index) => [`top${index}`, commandSource('args: []')])
    ];

    files.forEach(([name, source]) => writeCommand(dir, name ?? '', source ?? ''));

    return tree.topics * (tree.perTopic + tree.nestedPerTopic) + tree.topLevel;
}

const topicSource = (description: string): string => `import { defineTopic } from '@zjaaal/artemis';

export default defineTopic({ description: ${JSON.stringify(description)} });
`;
