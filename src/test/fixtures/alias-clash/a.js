import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Wants an alias that is already a command',
    aliases: ['b'],
    run: () => ({ name: 'a' })
});
