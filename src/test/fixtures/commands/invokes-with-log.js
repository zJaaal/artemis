import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Invokes a command and hands it a log of its own',
    run({ ctx }) {
        return ctx.invoke('logs', ['--log', 'other.log']);
    }
});
