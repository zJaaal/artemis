import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Fails with a plain error, which means a bug',
    run() {
        throw new Error('kaput');
    }
});
