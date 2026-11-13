import { ID_SEPARATOR } from '../constants.js';

/** Whether an id is the topic itself or sits anywhere under it. */
export const isWithin = (id: string, topicId: string): boolean =>
    id === topicId || id.startsWith(`${topicId}${ID_SEPARATOR}`);

/** Every topic id above a command id: `dotcms db seed` sits under `dotcms` and `dotcms db`. */
export const topicPrefixes = (id: string): string[] => {
    const words = id.split(ID_SEPARATOR).slice(0, -1);

    return words.map((_, index) => words.slice(0, index + 1).join(ID_SEPARATOR));
};
