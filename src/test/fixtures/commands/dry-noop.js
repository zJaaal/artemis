import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Supports --dry-run and has nothing to plan',
    dryRun: true,
    run: () => ({ done: true })
});
