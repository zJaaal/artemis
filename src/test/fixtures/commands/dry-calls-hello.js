import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Supports --dry-run but invokes a command that does not',
    dryRun: true,
    run({ ctx }) {
        return ctx.invoke('hello');
    }
});
