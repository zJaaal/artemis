import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Runs node -e <script> (or another command) through ctx.exec',
    dryRun: true,
    args: [{ name: 'script', required: true, description: 'JavaScript for node -e' }],
    flags: {
        command: { type: 'string', description: 'Run this instead of node' },
        capture: { type: 'boolean' },
        'read-only': { type: 'boolean' },
        'no-reject': { type: 'boolean' },
        timeout: { type: 'string' },
        cwd: { type: 'string' },
        pattern: { type: 'string', description: 'errorPattern, as a RegExp source' },
        'pattern-flags': { type: 'string', description: 'flags of the errorPattern' }
    },
    async run({ args, flags, ctx }) {
        const command = flags.command ?? process.execPath;
        const callArgs = flags.command ? [] : ['-e', args.script];

        return ctx.exec(command, callArgs, {
            capture: flags.capture,
            readOnly: flags['read-only'],
            reject: flags['no-reject'] ? false : undefined,
            timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
            cwd: flags.cwd,
            errorPattern: flags.pattern
                ? new RegExp(flags.pattern, flags['pattern-flags'])
                : undefined
        });
    }
});
