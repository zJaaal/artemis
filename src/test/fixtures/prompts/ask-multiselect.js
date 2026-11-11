import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Picks several',
    async run({ ctx }) {
        const answer = await ctx.prompt.multiselect('Steps?', {
            hint: 'Pass --yes to skip the question.',
            choices: [
                { label: 'Build', value: 'build', selected: true },
                { label: 'Test', value: 'test' }
            ]
        });

        ctx.log(JSON.stringify({ answer }));

        return { answer };
    }
});
