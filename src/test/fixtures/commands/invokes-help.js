import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Invokes another command with --help',
    run({ ctx }) {
        return ctx.invoke('hello', ['--help']);
    }
});
