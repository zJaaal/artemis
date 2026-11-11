import { defineCommand, CommandError } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Add two numbers',
    aliases: ['m:add'],
    args: [
        { name: 'a', description: 'First number', required: true },
        { name: 'b', description: 'Second number', required: true }
    ],
    run({ args }) {
        const sum = Number(args.a) + Number(args.b);

        if (Number.isNaN(sum)) {
            throw new CommandError('Both arguments must be numbers', { hint: 'Try: math add 1 2' });
        }

        return { sum };
    }
});
