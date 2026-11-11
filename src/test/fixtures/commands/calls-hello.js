import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Runs another command',
    run({ ctx }) {
        return ctx.invoke('hello', ['bob']);
    }
});
