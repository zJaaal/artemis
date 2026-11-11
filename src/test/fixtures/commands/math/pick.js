import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Pick a color',
    args: [{ name: 'color', description: 'Color', choices: ['red', 'blue'], default: 'red' }],
    flags: { tag: { type: 'string', multiple: true, description: 'Tags' } },
    run({ args, flags }) {
        return { color: args.color, tags: flags.tag ?? [] };
    }
});
