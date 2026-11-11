import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Invokes another command with a missing argument',
    run({ ctx }) {
        return ctx.invoke('math add', ['1']);
    }
});
