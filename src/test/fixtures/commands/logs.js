import { defineCommand } from '@zjaaal/artemis';

const CHILD = "console.log('child out'); console.error('child err')";

export default defineCommand({
    description: 'Prints through ctx.log, ctx.warn and a child',
    async run({ ctx }) {
        ctx.log('log line');
        ctx.warn('warn line');

        await ctx.exec(process.execPath, ['-e', CHILD]);

        return { done: true };
    }
});
