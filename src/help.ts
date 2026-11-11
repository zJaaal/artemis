import type {
    CommandHelpFn,
    CreateStyleFn,
    ManifestFn,
    RootHelpFn,
    TopicHelpFn,
    UsageFn
} from './models.js';

// Stubs: implemented in step 10.
export const createStyle: CreateStyleFn = () => {
    throw new Error('not implemented');
};

export const usage: UsageFn = () => {
    throw new Error('not implemented');
};

export const rootHelp: RootHelpFn = () => {
    throw new Error('not implemented');
};

export const topicHelp: TopicHelpFn = () => {
    throw new Error('not implemented');
};

export const commandHelp: CommandHelpFn = () => {
    throw new Error('not implemented');
};

export const manifest: ManifestFn = () => {
    throw new Error('not implemented');
};
