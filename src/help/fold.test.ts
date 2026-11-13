import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { BRIEF_FOLD_THRESHOLD } from '../constants.js';
import type { BriefManifest } from '../models.js';
import { art, envelope } from '../test/art.js';
import { BRIEF_FOLDED_MAX_BYTES } from '../test/constants.js';
import { writeGeneratedCommands } from '../test/generated-commands.js';
import { createTempFolders } from '../test/temp.js';

const folders = createTempFolders();

afterEach(() => folders.cleanUp());

/** A project of 200 commands: 10 topics of 19 (2 of them in a nested topic) and 10 in no topic. */
const bigProject = (): string => {
    const dir = path.join(folders.make('artemis-fold-'), 'commands');

    writeGeneratedCommands(dir, { topics: 10, perTopic: 17, nestedPerTopic: 2, topLevel: 10 });

    return dir;
};

/** A project with exactly `count` commands, spread over two topics, one command in no topic. */
const projectOf = (count: number): string => {
    const dir = path.join(folders.make('artemis-fold-'), 'commands');
    const inTopics = count - 1;

    writeGeneratedCommands(dir, { topics: 1, perTopic: inTopics, nestedPerTopic: 0, topLevel: 1 });

    return dir;
};

const briefOf = async (commandsDir: string, ...words: string[]): Promise<BriefManifest> =>
    envelope(await art(['help', ...words, '--json', '--brief'], { commandsDir }))
        .result as BriefManifest;

describe('help --brief: folding', () => {
    test('a project of exactly BRIEF_FOLD_THRESHOLD commands lists them all', async () => {
        const brief = await briefOf(projectOf(BRIEF_FOLD_THRESHOLD));

        expect(brief.commands).toHaveLength(BRIEF_FOLD_THRESHOLD);
    });

    test('one command more folds the listing to the commands in no topic', async () => {
        const brief = await briefOf(projectOf(BRIEF_FOLD_THRESHOLD + 1));

        expect(brief.commands.map((command) => command.id)).toEqual(['top0']);
    });

    test('a folded listing lists only the top-level topics, with all their commands counted', async () => {
        const brief = await briefOf(bigProject());

        expect(brief.topics).toHaveLength(10);
        expect(brief.topics.every((topic) => topic.commands === 19)).toBe(true);
    });

    test('a folded listing says how to open a topic', async () => {
        expect((await briefOf(bigProject())).more).toBe('art help <topic> --json --brief');
    });

    test('an unfolded listing says how to get one command', async () => {
        expect((await briefOf(projectOf(BRIEF_FOLD_THRESHOLD))).more).toBe(
            'art help <command> --json'
        );
    });

    test('an unfolded listing has the nested topics too', async () => {
        const dir = path.join(folders.make('artemis-fold-'), 'commands');

        writeGeneratedCommands(dir, { topics: 1, perTopic: 1, nestedPerTopic: 1, topLevel: 0 });

        expect((await briefOf(dir)).topics.map((topic) => topic.id).sort()).toEqual([
            'topic0',
            'topic0 sub'
        ]);
    });

    test('the folded listing of 200 commands is under its byte limit', async () => {
        const result = await art(['help', '--json', '--brief'], { commandsDir: bigProject() });

        expect(Buffer.byteLength(result.out)).toBeLessThan(BRIEF_FOLDED_MAX_BYTES);
    });

    test('the text folds the same way, with a count on every topic', async () => {
        const result = await art(['help', '--brief'], { commandsDir: bigProject() });

        expect(result.out).toMatch(/topic3\s+Commands of topic3 \(19 commands\)/);
    });

    test('the text of a folded listing has no command of a topic', async () => {
        const result = await art(['help', '--brief'], { commandsDir: bigProject() });

        expect(result.out).not.toContain('topic3 run4');
    });

    test('the text of a folded listing says it is a topic that opens, not a command', async () => {
        const result = await art(['help', '--brief'], { commandsDir: bigProject() });

        expect(result.out).toContain('One topic in full: art help <topic> --json --brief');
        expect(result.out).not.toContain('One command in full');
    });

    test('the text of an unfolded listing says one command in full', async () => {
        const result = await art(['help', '--brief'], {
            commandsDir: projectOf(BRIEF_FOLD_THRESHOLD)
        });

        expect(result.out).toContain('One command in full: art help <command> --json');
    });

    test('the text of a folded listing ends with how to open a topic', async () => {
        const result = await art(['help', '--brief'], { commandsDir: bigProject() });

        expect(result.out).toContain('art help <topic> --json --brief');
    });
});

describe('help <topic> --brief: never folded', () => {
    test('lists every command under the topic, at any depth', async () => {
        const brief = await briefOf(bigProject(), 'topic2');

        expect(brief.commands).toHaveLength(19);
    });

    test('lists the direct sub-topics with their counts', async () => {
        const brief = await briefOf(bigProject(), 'topic2');

        expect(brief.topics).toEqual([
            { id: 'topic2 sub', description: 'Nested commands of topic2', commands: 2 }
        ]);
    });

    test('says how to get one command, as an unfolded listing does', async () => {
        expect((await briefOf(bigProject(), 'topic2')).more).toBe('art help <command> --json');
    });
});
