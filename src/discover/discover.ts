import path from 'node:path';

import { COMMAND_EXTENSION, ID_SEPARATOR, PRIVATE_PREFIXES, TOPIC_FILE } from '../constants.js';
import { isCommand, isTopic } from '../define/define.js';
import { listDirectory, pathExists } from '../edges/files.js';
import { importDefault } from '../edges/modules.js';
import type { DirectoryEntry, DiscoverFn, Registry, WalkContext } from '../models.js';
import { messageOf } from '../utils/error-message.js';

const createRegistry = (): Registry => ({
    commands: new Map(),
    topics: new Map(),
    aliases: new Map(),
    warnings: []
});

// Files and folders starting with "_" or "." are private: helpers, data, the topic file
const isPublic = (name: string): boolean =>
    !PRIVATE_PREFIXES.some((prefix) => name.startsWith(prefix));

const byName = (a: DirectoryEntry, b: DirectoryEntry): number => a.name.localeCompare(b.name);

const isCommandFile = (name: string): boolean => name.endsWith(COMMAND_EXTENSION);

/** Loads one command file. A broken file is a warning, so one bad drop-in does not take the CLI down. */
async function loadCommand({ registry, root }: WalkContext, file: string, id: string) {
    const relative = path.relative(root, file);

    try {
        const definition = await importDefault(file);

        if (!isCommand(definition)) {
            registry.warnings.push(
                `${relative} is not a command (default export must come from defineCommand); skipped`
            );

            return 0;
        }

        registry.commands.set(id, { id, file, definition });

        return 1;
    } catch (error) {
        registry.warnings.push(`${relative} failed to load and was skipped: ${messageOf(error)}`);

        return 0;
    }
}

// A topic file that fails to load only costs the topic its description; the commands still work.
const ignoreBrokenTopicFile = (): undefined => undefined;

async function registerTopic({ registry }: WalkContext, dir: string, parts: string[]) {
    const topicFile = path.join(dir, TOPIC_FILE);

    const topic = pathExists(topicFile)
        ? await importDefault(topicFile).catch(ignoreBrokenTopicFile)
        : undefined;

    const id = parts.join(ID_SEPARATOR);

    registry.topics.set(id, { id, description: isTopic(topic) ? topic.description : '' });
}

/** Discovers one folder entry and returns how many commands it contributed. */
async function discoverEntry(
    context: WalkContext,
    dir: string,
    parts: string[],
    entry: DirectoryEntry
): Promise<number> {
    const file = path.join(dir, entry.name);

    if (entry.isDirectory) {
        return walk(context, file, [...parts, entry.name]);
    }

    if (!isCommandFile(entry.name)) {
        return 0;
    }

    const id = [...parts, entry.name.slice(0, -COMMAND_EXTENSION.length)].join(ID_SEPARATOR);

    return loadCommand(context, file, id);
}

/** Walks a folder; a folder that held at least one command becomes a topic. */
async function walk(context: WalkContext, dir: string, parts: string[]): Promise<number> {
    const entries = listDirectory(dir)
        .filter((entry) => isPublic(entry.name))
        .sort(byName);

    let found = 0;

    for (const entry of entries) {
        found += await discoverEntry(context, dir, parts, entry);
    }

    if (parts.length && found) {
        await registerTopic(context, dir, parts);
    }

    return found;
}

/** Aliases are claimed after every command is known, so a command name always beats an alias. */
function registerAliases(registry: Registry): void {
    const claims = [...registry.commands.values()].flatMap(({ id, definition }) =>
        definition.aliases.map((alias) => ({ alias, id }))
    );

    claims.forEach(({ alias, id }) => {
        const isTaken = registry.commands.has(alias) || registry.aliases.has(alias);

        if (isTaken) {
            registry.warnings.push(`alias "${alias}" of "${id}" is already taken; ignored`);
        } else {
            registry.aliases.set(alias, id);
        }
    });
}

/**
 * Walks the commands folder. Every public `.js` file is a command and every public folder is a
 * topic, so `commands/uve/config/set.js` becomes the command `uve config set` inside the topics
 * `uve` and `uve config`.
 */
export const discover: DiscoverFn = async (commandsDir) => {
    const registry = createRegistry();

    if (!pathExists(commandsDir)) {
        registry.warnings.push(`commands folder not found: ${commandsDir}`);

        return registry;
    }

    await walk({ registry, root: commandsDir }, commandsDir, []);
    registerAliases(registry);

    return registry;
};
