import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Needs an answer',
    async run({ ctx }) {
        const value = await ctx.prompt.confirm('Sure?', {
            hint: 'Pass --yes to skip the question.'
        });

        return { value };
    }
});
