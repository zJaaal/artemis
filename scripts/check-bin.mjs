// Run after `pnpm run build`. Packs the package, then runs the real binaries the way a user would:
// installed globally into a throwaway prefix (`art` and `artemis`, in projects that have nothing
// installed), and as a dependency of a consumer whose bin file is `import '@zjaaal/artemis/cli'`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXIT_FAILED = 1;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-bin-'));
const prefix = path.join(root, 'prefix');

const HELLO = `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Say hello',
    run: () => ({ greeting: 'hello' })
});
`;

// Reports which copy of the framework the command file got.
const WHERE = `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Where the framework comes from',
    run: () => ({ framework: import.meta.resolve('@zjaaal/artemis') })
});
`;

function makeProject(name, manifest = {}) {
    const folder = path.join(root, name);
    const commands = path.join(folder, 'commands');

    fs.mkdirSync(commands, { recursive: true });

    fs.writeFileSync(
        path.join(folder, 'package.json'),
        JSON.stringify({ name, type: 'module', ...manifest })
    );

    fs.writeFileSync(path.join(commands, 'hello.js'), HELLO);
    fs.writeFileSync(path.join(commands, 'where.js'), WHERE);

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

    const project = makeProject('project');
    const deep = path.join(project, 'src', 'deep');
    const art = path.join(prefix, 'bin', 'art');
    const artemis = path.join(prefix, 'bin', 'artemis');

    fs.mkdirSync(deep, { recursive: true });

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
        'a subfolder of the project still finds it'
    );

    console.log('ok   the installed art and artemis run the commands of the project they are in');

    const framework = json(execute(art, ['where', '--json'], project)).result.framework;

    assert.ok(
        framework.startsWith(`file://${fs.realpathSync(prefix)}`),
        `global copy expected, got ${framework}`
    );

    console.log('ok   a project with no copy of the framework gets the running one');

    const nowhere = fs.mkdtempSync(path.join(root, 'nowhere-'));
    const missing = execute(art, ['hello', '--json'], nowhere);

    assert.equal(missing.code, EXIT_FAILED, 'outside any project it fails');
    assert.equal(json(missing).command, null);
    assert.equal(json(missing).ok, false);
    console.log('ok   outside any project it fails with a JSON error and a hint');

    // 2. A consumer that ships the same CLI under its own name with a one-line bin file.
    const consumer = makeProject('consumer', { bin: { mytool: 'bin/mytool.js' } });
    const bin = path.join(consumer, 'bin', 'mytool.js');

    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, "import '@zjaaal/artemis/cli';\n");
    execFileSync('npm', ['install', tarball], { cwd: consumer, stdio: 'ignore' });

    const own = execute(process.execPath, [bin, 'help', '--json'], consumer);

    assert.equal(json(own).result.bin, 'mytool', 'the consumer CLI shows its own name');

    assert.deepEqual(json(execute(process.execPath, [bin, 'hello', '--json'], consumer)).result, {
        greeting: 'hello'
    });

    console.log('ok   a one-line bin file gives a project its own command name');

    const local = json(execute(process.execPath, [bin, 'where', '--json'], consumer)).result
        .framework;

    assert.ok(
        local.startsWith(`file://${fs.realpathSync(consumer)}`),
        `local copy expected, got ${local}`
    );

    console.log('ok   a copy the project installed itself wins over the running one');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
