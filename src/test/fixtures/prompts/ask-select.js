import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Picks one',
    async run({ ctx }) {
        const answer = await ctx.prompt.select('Runner?', {
            hint: 'Pass --yes to skip the question.',
            choices: [
                { label: 'Node', value: 'node', description: 'The default' },
                { label: 'Deno', value: 'deno' }
            ]
        });

        ctx.log(JSON.stringify({ answer }));

        return { answer };
    }
});
