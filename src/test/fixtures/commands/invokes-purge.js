import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Calls the destructive purge command',
    run({ ctx }) {
        return ctx.invoke('purge');
    }
});
