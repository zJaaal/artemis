import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Wants an alias that is already a topic',
    aliases: ['math'],
    run: () => ({ name: 'solo' })
});
