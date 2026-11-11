import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Prints its argument',
    args: [{ name: 'text', required: true }],
    run({ args, ctx }) {
        ctx.log(args.text);

        return { text: args.text };
    }
});
