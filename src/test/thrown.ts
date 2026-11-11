import type { ThrownByFn } from './models.js';

/** What `work` throws, so a test can assert on the error without a try/catch in its body. */
export const thrownBy: ThrownByFn = (work) => {
    try {
        work();
    } catch (error) {
        return error;
    }

    return undefined;
};
