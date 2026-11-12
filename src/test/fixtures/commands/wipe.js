import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Delete the data of an instance',
    destructive: true,
    dryRun: true,
    run({ ctx }) {
        ctx.plan('remove the data folder');

        if (ctx.dryRun) {
            return { wiped: false };
        }

        ctx.log('wiped');

        return { wiped: true };
    }
});
