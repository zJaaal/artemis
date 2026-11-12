import fs from 'node:fs';

import { CommandError, defineCommand } from '@zjaaal/artemis';

const POLL_MS = 20;
const WAIT_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (file) => {
    for (let waited = 0; waited < WAIT_MS && !fs.existsSync(file); waited += POLL_MS) {
        await sleep(POLL_MS);
    }
};

const worker = (pidFile) =>
    `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;

export default defineCommand({
    description: 'Starts two children it never awaits, then fails',
    args: [
        { name: 'first', required: true },
        { name: 'second', required: true }
    ],
    async run({ args, ctx }) {
        [args.first, args.second].forEach((file) => {
            ctx.exec(process.execPath, ['-e', worker(file)]).catch(() => undefined);
        });

        await waitFor(args.first);
        await waitFor(args.second);

        throw new CommandError('stopped on purpose');
    }
});
