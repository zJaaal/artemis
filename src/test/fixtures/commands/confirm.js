import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Asks only when someone can answer',
    async run({ ctx }) {
        if (!ctx.interactive) {
            ctx.log(JSON.stringify({ value: true, asked: false }));

            return { value: true, asked: false };
        }

        const { value } = await ctx.prompt({ type: 'confirm', name: 'value', message: 'Sure?' });

        ctx.log(JSON.stringify({ value, asked: true }));

        return { value, asked: true };
    }
});
