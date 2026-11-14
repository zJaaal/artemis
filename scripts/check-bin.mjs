// Run after `pnpm run build`. Packs the package, then runs the real binaries the way a user would:
// installed globally into a throwaway prefix (`art` and `artemis`, in projects that have nothing
// installed), and as a dependency of a consumer whose bin file calls `cli({ root: import.meta.url })`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const NOISY_LINES = 2000;
const PACKED_ROOT_FILES = ['README.md', 'LICENSE', 'package.json', 'AGENTS.md'];

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-bin-'));
const prefix = path.join(root, 'prefix');

const COMMANDS = {
    'hello.js': `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Say hello',
    run: () => ({ greeting: 'hello' })
});
`,
    // Reports which copy of the framework the command file got.
    'where.js': `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Where the framework comes from',
    run: () => ({ framework: import.meta.resolve('@zjaaal/artemis') })
});
`,
    // Errors with a hint and an exit code: thrown by whichever copy the command file got.
    'fail.js': `import { CommandError, defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Fails with a hint',
    run: () => {
        throw new CommandError('it failed', { hint: 'fix it like this' });
    }
});
`,
    // Starts a child that outlives it: the check below finds it alive after the binary has exited.
    'background.js': `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Starts a child in the background',
    run: ({ ctx }) =>
        ctx.exec(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
            detached: true,
            logFile: 'background.log'
        })
});
`,
    'wrong.js': `import { UsageError, defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Is a wrong command line',
    run: () => {
        throw new UsageError('that was wrong', { hint: 'say it like this' });
    }
});
`
};

function makeProject(name, manifest = {}) {
    const folder = path.join(root, name);
    const commands = path.join(folder, 'commands');

    fs.mkdirSync(commands, { recursive: true });

    fs.writeFileSync(
        path.join(folder, 'package.json'),
        JSON.stringify({ name, type: 'module', ...manifest })
    );

    for (const [file, text] of Object.entries(COMMANDS)) {
        fs.writeFileSync(path.join(commands, file), text);
    }

    return folder;
}

function execute(file, args, cwd) {
    const result = spawnSync(file, args, { cwd, encoding: 'utf8' });

    return { code: result.status, out: result.stdout, err: result.stderr };
}

const json = (result) => JSON.parse(result.out);

try {
    const packed = execFileSync('npm', ['pack', '--pack-destination', root, '--json'], {
        encoding: 'utf8'
    });

    const tarball = path.join(root, JSON.parse(packed)[0].filename);

    // 1. Installed globally: `art` and `artemis`, in a project that has nothing installed.
    execFileSync('npm', ['install', '--global', '--prefix', prefix, tarball], { stdio: 'ignore' });

    const art = path.join(prefix, 'bin', 'art');
    const artemis = path.join(prefix, 'bin', 'artemis');
    const project = makeProject('project');
    const deep = path.join(project, 'src', 'deep');
    const marked = path.join(project, 'src', 'marked');

    fs.mkdirSync(deep, { recursive: true });
    fs.mkdirSync(marked, { recursive: true });
    fs.writeFileSync(path.join(marked, 'package.json'), '{ "type": "module" }');

    assert.equal(
        json(execute(art, ['help', '--json'], project)).result.bin,
        'art',
        'help shows art'
    );

    assert.deepEqual(json(execute(art, ['hello', '--json'], project)).result, {
        greeting: 'hello'
    });

    assert.deepEqual(json(execute(artemis, ['hello', '--json'], project)).result, {
        greeting: 'hello'
    });

    assert.deepEqual(
        json(execute(art, ['hello', '--json'], deep)).result,
        { greeting: 'hello' },
        'a subfolder'
    );

    assert.deepEqual(
        json(execute(art, ['hello', '--json'], marked)).result,
        { greeting: 'hello' },
        'a subfolder holding a bare type marker package.json'
    );

    console.log('ok   the installed art and artemis run the commands of the project they are in');

    // Every run of a project command leaves one line in the audit trail, and `art history` returns it.
    const history = json(execute(art, ['history', 'hello', '--json'], project)).result;

    assert.ok(history.entries.length >= 1, 'art history returns the runs of hello');
    assert.equal(history.entries[0].command, 'hello');
    assert.equal(history.entries[0].exitCode, 0);
    assert.ok(fs.existsSync(path.join(project, 'state', 'audit.jsonl')), 'in state/audit.jsonl');
    console.log('ok   every run of a project command leaves a line that art history returns');

    // A detached child is still running after `art` has exited, and its output went to its log file.
    const background = json(execute(art, ['background', '--json'], project)).result;

    try {
        process.kill(background.pid, 0);
        console.log('ok   a detached child is still running after art has exited');
    } finally {
        process.kill(-background.pid, 'SIGKILL');
    }

    assert.ok(fs.existsSync(path.join(project, 'background.log')), 'the log file of the child');

    const framework = json(execute(art, ['where', '--json'], project)).result.framework;

    assert.ok(
        framework.startsWith(`file://${fs.realpathSync(prefix)}`),
        `global copy expected, got ${framework}`
    );

    console.log('ok   a project with no copy of the framework gets the running one');

    const publisher = makeProject('publisher', { bin: { foo: 'bin/foo.js' } });

    assert.equal(
        json(execute(art, ['help', '--json'], publisher)).result.bin,
        'art',
        'never the name of another CLI'
    );

    console.log('ok   a project that publishes an unrelated CLI still sees art');

    const nowhere = fs.mkdtempSync(path.join(root, 'nowhere-'));
    const missing = execute(art, ['hello', '--json'], nowhere);

    assert.equal(missing.code, EXIT_FAILED, 'outside any project it fails');
    assert.equal(json(missing).command, null);
    assert.equal(json(missing).ok, false);
    console.log('ok   outside any project it fails with a JSON error and a hint');

    // A package.json that cannot be parsed is an error, never skipped: running another project's commands silently is worse.
    const templates = path.join(project, 'templates');

    fs.mkdirSync(templates);
    fs.writeFileSync(path.join(templates, 'package.json'), '{ "name": "{{name}}", }');

    const broken = execute(art, ['hello', '--json'], templates);

    assert.equal(broken.code, EXIT_FAILED, 'a package.json that is not valid JSON fails');
    assert.equal(json(broken).ok, false);
    assert.equal(json(broken).command, null);
    assert.match(json(broken).error, /package\.json is not valid JSON/);
    console.log('ok   a package.json that is not valid JSON fails loudly, naming the file');

    // Only an artemis key or a commands folder makes a project, so a template or a marker with any keys is never a candidate.
    const validTemplate = path.join(project, 'valid-template');
    const esm = path.join(project, 'dist', 'esm');

    fs.mkdirSync(validTemplate);
    fs.mkdirSync(esm, { recursive: true });
    fs.writeFileSync(path.join(validTemplate, 'package.json'), '{ "name": "{{name}}" }');
    fs.writeFileSync(path.join(esm, 'package.json'), '{ "type": "module", "sideEffects": false }');

    assert.deepEqual(json(execute(art, ['hello', '--json'], validTemplate)).result, {
        greeting: 'hello'
    });

    assert.deepEqual(json(execute(art, ['hello', '--json'], esm)).result, { greeting: 'hello' });
    console.log('ok   a template or a marker with extra keys never stops the search');

    // `art init` makes a folder a project, and the sample it writes runs at once.
    const fresh = fs.mkdtempSync(path.join(root, 'fresh-'));
    const initialised = execute(art, ['init', '--json'], fresh);

    assert.equal(initialised.code, 0, 'init succeeds');
    assert.equal(json(initialised).command, 'init');

    assert.deepEqual(
        json(execute(art, ['hello', '--json'], fresh)).result,
        { greeting: 'hello world' },
        'the sample command runs right after init'
    );

    assert.deepEqual(
        json(execute(art, ['init', '--json'], fresh)).result.created,
        [],
        'a second init changes nothing'
    );

    console.log('ok   art init makes a folder a project, and its sample runs at once');

    // init takes no arguments: it is a fixed word of the binary, not a command.
    const withArgument = execute(art, ['init', 'somewhere', '--json'], fresh);

    assert.equal(withArgument.code, EXIT_USAGE, 'an argument to init is a usage error');
    assert.equal(json(withArgument).error, 'init takes no arguments, but got "somewhere"');
    console.log('ok   init takes no arguments, and says so');

    // The store kit and `art state`: a command writes a document through defineStore({ project }) under a
    // global art with no local copy, and `art state` reads, shows and resets it from the same folder.
    const stateful = makeProject('stateful', { artemis: { stateDir: 'data' } });

    fs.writeFileSync(
        path.join(stateful, 'commands', 'save.js'),
        `import { defineCommand } from '@zjaaal/artemis';
import { defineStore } from '@zjaaal/artemis/store';

export default defineCommand({
    description: 'Saves a document',
    run: () => {
        const doc = defineStore({ project: import.meta.url }).doc('notes', { fallback: { count: 0 } });

        return doc.update((current) => ({ count: current.count + 1 }));
    }
});
`
    );

    assert.deepEqual(
        json(execute(art, ['save', '--json'], stateful)).result,
        { count: 1 },
        'the command writes through the store kit, resolved from the running copy'
    );

    const notes = path.join(stateful, 'data', 'notes.json');
    const listed = json(execute(art, ['state', '--json'], stateful));

    assert.deepEqual(
        listed.result,
        {
            dir: fs.realpathSync(path.join(stateful, 'data')),
            documents: [{ name: 'notes', version: 0, file: fs.realpathSync(notes) }]
        },
        'art state lists what the command wrote, in the folder of stateDir'
    );

    assert.deepEqual(
        json(execute(art, ['state', 'notes', '--json'], path.join(stateful, 'commands'))).result
            .data,
        { count: 1 },
        'art state shows it, from a subfolder'
    );

    const refused = execute(art, ['state', 'notes', '--reset', '--json'], stateful);

    assert.equal(refused.code, EXIT_FAILED, 'a reset without --yes and nobody to answer fails');
    assert.equal(json(refused).hint, 'Pass --yes to reset without a question.');
    assert.ok(fs.existsSync(notes), 'and the file is still there');

    const reset = execute(art, ['state', 'notes', '--reset', '--yes', '--json'], stateful);

    assert.equal(reset.code, 0);
    assert.equal(json(reset).result.reset, true);
    assert.ok(!fs.existsSync(notes), 'a reset with --yes deletes the file');

    assert.deepEqual(
        json(execute(art, ['save', '--json'], stateful)).result,
        { count: 1 },
        'after a reset the app starts again from its defaults'
    );

    const builtins = json(execute(art, ['help', '--json'], stateful)).result.builtins;

    assert.deepEqual(
        builtins.map((builtin) => builtin.id),
        ['init', 'state', 'skill', 'doctor', 'history'],
        'help --json lists the built-in words'
    );

    console.log(
        'ok   art state lists, shows and resets what a command wrote through the store kit'
    );

    // Agent economy: the brief manifest, destructive and dry-run, quiet and log, the skill, the shipped
    // AGENTS.md and the doctor, all through the installed art.
    const agentic = makeProject('agentic');
    const wiped = path.join(agentic, 'wiped');

    fs.writeFileSync(
        path.join(agentic, 'commands', 'wipe.js'),
        `import fs from 'node:fs';
import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Delete the data',
    destructive: true,
    dryRun: true,
    examples: ['wipe'],
    run({ ctx }) {
        ctx.plan('write the wiped marker');

        if (ctx.dryRun) {
            return { wiped: false };
        }

        fs.writeFileSync(${JSON.stringify(wiped)}, '1');

        return { wiped: true };
    }
});
`
    );

    fs.writeFileSync(
        path.join(agentic, 'commands', 'noisy.js'),
        `import { defineCommand } from '@zjaaal/artemis';

const CHILD = "for (let i = 0; i < ${NOISY_LINES}; i++) console.log('line ' + i)";

export default defineCommand({
    description: 'Runs a child that prints a lot',
    async run({ ctx }) {
        await ctx.exec(process.execPath, ['-e', CHILD]);

        return { done: true };
    }
});
`
    );

    const brief = json(execute(art, ['help', '--json', '--brief'], agentic)).result;
    const wipeEntry = brief.commands.find((command) => command.id === 'wipe');

    assert.deepEqual(
        wipeEntry,
        {
            id: 'wipe',
            description: 'Delete the data',
            usage: 'wipe',
            destructive: true,
            dryRun: true
        },
        'the brief manifest marks what an agent must not miss'
    );

    assert.equal(brief.more, 'art help <command> --json');
    assert.equal(brief.globalFlags, '--help --json --yes --dry-run --quiet --log <file>');
    assert.equal(brief.search, 'art help --search <words> --json');
    console.log('ok   help --json --brief lists ids and descriptions, with the two markers');

    const refusedWipe = execute(art, ['wipe', '--json'], agentic);

    assert.equal(
        refusedWipe.code,
        EXIT_FAILED,
        'a destructive command with nobody to answer fails'
    );

    assert.match(json(refusedWipe).hint, /Pass --yes to confirm\./);
    assert.ok(!fs.existsSync(wiped), 'and run was never called');
    console.log('ok   a destructive command run with --json and no --yes exits 1 with the hint');

    const planned = execute(art, ['wipe', '--dry-run', '--json'], agentic);

    assert.deepEqual(
        [json(planned).dryRun, json(planned).plan],
        [true, ['write the wiped marker']],
        'a dry run carries its plan'
    );

    assert.ok(!fs.existsSync(wiped), 'and changes nothing on disk');

    assert.equal(
        execute(art, ['hello', '--dry-run'], agentic).code,
        EXIT_USAGE,
        'not on a command that does not support it'
    );

    console.log('ok   --dry-run --json gives a plan and changes nothing');

    const quiet = execute(art, ['noisy', '--json', '--quiet'], agentic);

    assert.equal(
        quiet.err,
        '',
        'a child that prints 2,000 lines writes nothing to stderr under --quiet'
    );

    assert.deepEqual(json(quiet).result, { done: true }, 'and stdout is exactly one object');

    const logFile = path.join(agentic, 'noisy.log');
    const logged = execute(art, ['noisy', '--json', '--quiet', '--log', logFile], agentic);

    assert.equal(json(logged).log, logFile, 'the envelope names the log');

    assert.equal(
        fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length,
        NOISY_LINES,
        'and the file has every line'
    );

    console.log('ok   --quiet keeps a noisy child out of the output, and --log keeps every line');

    const skill = execute(art, ['skill'], agentic).out;

    assert.match(skill, /^---\nname: art\n/);
    assert.ok(skill.includes('`art help --authoring`'), 'the skill names help --authoring');

    assert.ok(
        skill.includes('- `art wipe`: Delete the data (`--dry-run`)'),
        'and lists the destructive commands'
    );

    console.log('ok   art skill is built from the manifest and points at help --authoring');

    // The packed AGENTS.md, from a project with no local copy: it must name nothing the package does not ship.
    const agents = json(execute(art, ['help', '--agents', '--json'], agentic)).result;
    const authoring = json(execute(art, ['help', '--authoring', '--json'], agentic)).result;
    const shipped = fs.readFileSync('AGENTS.md', 'utf8');
    const calling = agents.markdown.split('\n\nTo write a command')[0];

    assert.ok(shipped.includes(calling), 'help --agents prints a section of the packed AGENTS.md');
    assert.ok(shipped.includes(authoring.markdown.split('\n\n## Running')[0]));
    assert.ok(Buffer.byteLength(agents.markdown) < 5 * 1024, 'and stays under 5 KB');

    const outside = `${agents.markdown}\n${authoring.markdown}`
        .split('\n')
        .filter((line) => /docs\/|specs\/|CODE_STANDARDS|pnpm run/.test(line));

    assert.deepEqual(outside, [], 'and it names no file or script the package does not ship');

    console.log(
        'ok   help --agents prints the AGENTS.md of the running copy, with no global install needed'
    );

    const listing = JSON.parse(
        execFileSync('npm', ['pack', '--dry-run', '--json'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        })
    )[0].files.map((file) => file.path);

    const unexpected = listing.filter(
        (file) => !file.startsWith('dist/') && !PACKED_ROOT_FILES.includes(file)
    );

    assert.deepEqual(
        unexpected,
        [],
        'the package holds dist/ and the root files, and nothing else'
    );

    for (const file of PACKED_ROOT_FILES) {
        assert.ok(listing.includes(file), `${file} is in the package`);
    }

    assert.ok(
        !listing.includes('CONTRIBUTING.md') && !listing.includes('CLAUDE.md'),
        'and the repository-only files are not'
    );

    console.log(
        'ok   the package holds dist/, README, LICENSE, package.json and AGENTS.md, and nothing else'
    );

    // A project that installs another copy than the one that runs: the doctor says so, and the warning is not doubled on it.
    const other = path.join(root, 'other');
    const otherCopy = path.join(other, 'node_modules', '@zjaaal', 'artemis');

    fs.mkdirSync(path.join(other, 'commands'), { recursive: true });
    fs.mkdirSync(otherCopy, { recursive: true });

    fs.writeFileSync(
        path.join(other, 'package.json'),
        JSON.stringify({ name: 'other', type: 'module', artemis: {} })
    );

    fs.writeFileSync(
        path.join(otherCopy, 'package.json'),
        JSON.stringify({ name: '@zjaaal/artemis', version: '0.0.1' })
    );

    const doctor = execute(art, ['doctor', '--json'], other);
    const installed = json(doctor).result.checks.find((check) => check.id === 'installed');

    assert.equal(installed.status, 'warn', 'the doctor warns about the other copy');
    assert.ok(installed.fix, 'with a fix');
    assert.ok(!doctor.err.includes('Run art doctor'), 'and prints no every-run line on top');

    const everyRun = execute(art, ['help', '--json'], other);

    assert.equal(
        everyRun.err.split('\n').filter((line) => line.includes('Run art doctor.')).length,
        1,
        'any other run prints exactly one line'
    );

    assert.ok(JSON.parse(everyRun.out).ok, 'and stdout is still one object');

    console.log(
        'ok   art doctor reports a different installed copy; every other run says so once on stderr'
    );

    // 2. A consumer that ships the same CLI under its own name, with the framework as a dependency.
    const consumer = makeProject('consumer', { bin: { mytool: 'bin/mytool.js' } });
    const bin = path.join(consumer, 'bin', 'mytool.js');

    fs.mkdirSync(path.dirname(bin), { recursive: true });

    fs.writeFileSync(
        bin,
        "import { cli } from '@zjaaal/artemis/cli';\n\nprocess.exitCode = await cli({ root: import.meta.url });\n"
    );

    execFileSync('npm', ['install', tarball], { cwd: consumer, stdio: 'ignore' });

    const own = (args, cwd) => execute(process.execPath, [bin, ...args], cwd);

    assert.equal(json(own(['help', '--json'], consumer)).result.bin, 'mytool', 'its own name');
    assert.deepEqual(json(own(['hello', '--json'], consumer)).result, { greeting: 'hello' });
    console.log('ok   a bin file with cli({ root }) gives a project its own command name');

    assert.deepEqual(
        json(own(['hello', '--json'], nowhere)).result,
        { greeting: 'hello' },
        'the tool runs its own commands from an unrelated folder'
    );

    assert.equal(
        json(own(['help', '--json'], publisher)).result.commands.length,
        Object.keys(COMMANDS).length
    );

    console.log('ok   the tool runs its own commands wherever the user is standing');

    // A tool that ships its bin file in dist/, next to a { "type": "module" } marker, still finds its own package.
    const dist = path.join(consumer, 'dist');

    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'package.json'), '{ "type": "module", "sideEffects": false }');

    fs.writeFileSync(
        path.join(dist, 'bin.js'),
        "import { cli } from '@zjaaal/artemis/cli';\n\nprocess.exitCode = await cli({ root: import.meta.url });\n"
    );

    assert.deepEqual(
        json(execute(process.execPath, [path.join(dist, 'bin.js'), 'hello', '--json'], nowhere))
            .result,
        { greeting: 'hello' },
        'a type marker in dist does not stop the search at dist'
    );

    console.log(
        'ok   a tool with its bin file in dist, next to a type marker, still finds its own commands'
    );

    const local = json(own(['where', '--json'], nowhere)).result.framework;

    assert.ok(
        local.startsWith(`file://${fs.realpathSync(consumer)}`),
        `local copy expected, got ${local}`
    );

    console.log('ok   a copy the project installed itself wins over the running one');

    // A tool that does not ship its commands must not run the commands of the project it is installed in.
    const bare = path.join(consumer, 'node_modules', 'bare-tool');
    const bareBin = path.join(bare, 'bin', 'bare-tool.js');

    fs.mkdirSync(path.dirname(bareBin), { recursive: true });

    fs.writeFileSync(
        path.join(bare, 'package.json'),
        JSON.stringify({
            name: 'bare-tool',
            type: 'module',
            bin: { 'bare-tool': 'bin/bare-tool.js' }
        })
    );

    fs.writeFileSync(
        bareBin,
        "import { cli } from '@zjaaal/artemis/cli';\n\nprocess.exitCode = await cli({ root: import.meta.url });\n"
    );

    const bareRun = execute(process.execPath, [bareBin, 'hello', '--json'], consumer);

    assert.equal(bareRun.code, EXIT_FAILED, 'a tool with no commands fails');

    // The folder named is the TOOL's own: a climb out of the tool would name the consumer's commands folder instead.
    assert.equal(
        json(bareRun).error,
        `Commands folder not found: ${path.join(fs.realpathSync(bare), 'commands')}`,
        'it names the tool’s own commands folder, never the consumer’s'
    );

    assert.match(json(bareRun).hint, /author has to ship the commands folder/);

    console.log(
        'ok   a tool that does not ship its commands fails instead of running its installer’s'
    );

    // The same for a private tool with no name: whatever its package.json says besides "type", it is the tool's package.
    const unnamed = path.join(consumer, 'node_modules', 'unnamed-tool');
    const unnamedBin = path.join(unnamed, 'bin', 'unnamed-tool.js');

    fs.mkdirSync(path.dirname(unnamedBin), { recursive: true });

    fs.writeFileSync(
        path.join(unnamed, 'package.json'),
        JSON.stringify({
            private: true,
            type: 'module',
            bin: { 'unnamed-tool': 'bin/unnamed-tool.js' }
        })
    );

    fs.writeFileSync(unnamedBin, fs.readFileSync(bareBin, 'utf8'));

    const unnamedRun = execute(process.execPath, [unnamedBin, 'hello', '--json'], consumer);

    assert.equal(unnamedRun.code, EXIT_FAILED, 'an unnamed tool with no commands fails');

    assert.equal(
        json(unnamedRun).error,
        `Commands folder not found: ${path.join(fs.realpathSync(unnamed), 'commands')}`,
        'it names the tool’s own commands folder'
    );

    console.log('ok   an unnamed private tool that does not ship its commands fails too');

    // A tool that declares no bin, and an installed package with no name, bin or key, are still their own package:
    // neither climbs into the consumer that holds it.
    for (const [folder, manifest] of [
        ['no-bin-tool', { name: 'no-bin-tool', type: 'module' }],
        ['empty-tool', { private: true, type: 'module' }]
    ]) {
        const toolDir = path.join(consumer, 'node_modules', folder);
        const toolBin = path.join(toolDir, 'bin', `${folder}.js`);

        fs.mkdirSync(path.dirname(toolBin), { recursive: true });
        fs.writeFileSync(path.join(toolDir, 'package.json'), JSON.stringify(manifest));
        fs.writeFileSync(toolBin, fs.readFileSync(bareBin, 'utf8'));

        const toolRun = execute(process.execPath, [toolBin, 'hello', '--json'], consumer);

        assert.equal(
            toolRun.code,
            EXIT_FAILED,
            `${folder} fails instead of running the consumer’s commands`
        );

        assert.equal(
            json(toolRun).error,
            `Commands folder not found: ${path.join(fs.realpathSync(toolDir), 'commands')}`,
            `${folder} names its own commands folder`
        );
    }

    console.log('ok   a tool with no bin, or no identity at all, never climbs into its host');

    // A root that is not a file URL or a path is a reported failure, not a crash.
    const badRootBin = path.join(consumer, 'bin', 'bad-root.js');

    fs.writeFileSync(
        badRootBin,
        "import { cli } from '@zjaaal/artemis/cli';\n\nprocess.exitCode = await cli({ root: 'http://example.com/bin.js' });\n"
    );

    const badRoot = execute(process.execPath, [badRootBin, 'hello', '--json'], consumer);

    assert.equal(badRoot.code, EXIT_FAILED);
    assert.equal(json(badRoot).ok, false);
    assert.equal(badRoot.err.includes('\n    at '), false, 'no stack trace');
    console.log('ok   a bad root is a reported failure, not a stack trace');

    // 3. The global art runs the consumer, whose command files use the consumer's own copy.
    const failed = execute(art, ['fail', '--json'], consumer);

    assert.equal(failed.code, EXIT_FAILED);

    assert.deepEqual(
        { error: json(failed).error, hint: json(failed).hint },
        { error: 'it failed', hint: 'fix it like this' },
        'the hint of an error from the local copy survives'
    );

    const wrong = execute(art, ['wrong', '--json'], consumer);

    assert.equal(wrong.code, EXIT_USAGE, 'a usage error from the local copy still exits 2');
    assert.equal(json(wrong).hint, 'say it like this');

    assert.equal(
        execute(art, ['fail'], consumer).err.includes('\n    at '),
        false,
        'no stack trace'
    );

    console.log('ok   errors thrown by a project’s own copy keep their hint and exit code');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
