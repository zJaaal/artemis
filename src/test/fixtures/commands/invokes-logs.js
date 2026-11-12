import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Prints a line, then invokes a command that prints more',
    async run({ ctx }) {
        ctx.log('caller line');

        return ctx.invoke('logs');
    }
});
