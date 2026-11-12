import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Delete everything, with no way to preview it',
    destructive: true,
    run({ ctx }) {
        ctx.log('purged');

        return { purged: true };
    }
});
