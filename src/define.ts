import type { DefineCommandFn, DefineTopicFn, IsCommandFn, IsTopicFn } from './models.js';

// Stubs: implemented in step 6.
export const defineCommand: DefineCommandFn = () => {
    throw new Error('not implemented');
};

export const defineTopic: DefineTopicFn = () => {
    throw new Error('not implemented');
};

export const isCommand: IsCommandFn = (value): value is never => {
    throw new Error(`not implemented: ${String(value)}`);
};

export const isTopic: IsTopicFn = (value): value is never => {
    throw new Error(`not implemented: ${String(value)}`);
};
