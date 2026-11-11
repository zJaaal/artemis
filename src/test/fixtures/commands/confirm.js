import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Asks only when someone can answer',
    async run({ ctx }) {
        if (!ctx.interactive) return { value: true, asked: false };

        const { value } = await ctx.prompt({ type: 'confirm', name: 'value', message: 'Sure?' });

        return { value, asked: true };
    }
});
