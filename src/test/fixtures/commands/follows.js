import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Succeeds and suggests what to run next',
    run({ ctx }) {
        ctx.next('hello ana --json', 'math add 1 2');
        ctx.next('hello ana --json');

        return { done: true };
    }
});
