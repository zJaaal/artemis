import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Asks for text',
    async run({ ctx }) {
        const answer = await ctx.prompt.text('Name?', {
            initial: 'world',
            hint: 'Pass --yes to skip the question.'
        });

        ctx.log(JSON.stringify({ answer }));

        return { answer };
    }
});
