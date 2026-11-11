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

    const local = json(own(['where', '--json'], nowhere)).result.framework;

    assert.ok(
        local.startsWith(`file://${fs.realpathSync(consumer)}`),
        `local copy expected, got ${local}`
    );

    console.log('ok   a copy the project installed itself wins over the running one');

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
