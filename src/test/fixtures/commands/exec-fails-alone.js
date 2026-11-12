import { defineCommand } from '@zjaaal/artemis';

const SETTLE_MS = 400;

export default defineCommand({
    description: 'Starts a child it never awaits, which fails on its own while the run goes on',
    async run({ ctx }) {
        void ctx.exec(process.execPath, ['-e', 'process.exit(3)']);

        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

        return { done: true };
    }
});
