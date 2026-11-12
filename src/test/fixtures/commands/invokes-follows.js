import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Invokes a command that suggests a next step, and suggests nothing itself',
    run({ ctx }) {
        return ctx.invoke('follows');
    }
});
