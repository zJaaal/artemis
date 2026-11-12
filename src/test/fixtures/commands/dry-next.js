import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Supports --dry-run and suggests a next step either way',
    dryRun: true,
    run({ ctx }) {
        ctx.next('hello');

        return { done: true };
    }
});
