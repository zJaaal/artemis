import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Asks yes or no',
    async run({ ctx }) {
        const answer = await ctx.prompt.confirm('Sure?', {
            initial: true,
            hint: 'Pass --yes to skip the question.'
        });

        ctx.log(JSON.stringify({ answer }));

        return { answer };
    }
});
