import { CommandError, defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Suggests a next step and then fails',
    run({ ctx }) {
        ctx.next('hello');

        throw new CommandError('it failed', { hint: 'try again' });
    }
});
