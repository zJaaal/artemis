import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Starts node -e <script> in the background, its output in a log file',
    dryRun: true,
    args: [
        { name: 'script', required: true, description: 'JavaScript for node -e' },
        { name: 'log', required: true, description: 'The log file of the child' }
    ],
    flags: { cwd: { type: 'string' } },
    async run({ args, flags, ctx }) {
        return ctx.exec(process.execPath, ['-e', args.script], {
            detached: true,
            logFile: args.log,
            cwd: flags.cwd
        });
    }
});
