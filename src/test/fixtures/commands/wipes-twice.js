import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Wipes, through ctx.invoke, and plans one more step of its own',
    dryRun: true,
    destructive: true,
    async run({ ctx }) {
        ctx.plan('stop the instance');

        return ctx.invoke('wipe');
    }
});
