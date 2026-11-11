// Run after `pnpm run build`. Packs the package, installs the tarball globally into a throwaway
// prefix, and runs the real `artemis` binary in temporary projects that have nothing installed.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXIT_FAILED = 1;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-bin-'));
const home = path.join(root, 'home');
const prefix = path.join(root, 'prefix');
const artemis = path.join(prefix, 'bin', 'artemis');

const command = (greeting) => `import { defineCommand } from '@zjaaal/artemis';

export default defineCommand({
    description: 'Say hello',
    run: () => ({ greeting: '${greeting}' })
});
`;

function makeProject(name, greeting) {
    const folder = path.join(root, name);
    const commands = path.join(folder, '.artemis', 'commands');

    fs.mkdirSync(commands, { recursive: true });
    fs.writeFileSync(path.join(commands, 'hello.js'), command(greeting));

    return folder;
}

function artemisIn(cwd, ...args) {
    const result = spawnSync(artemis, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, HOME: home, ARTEMIS_COMMANDS: '', ARTEMIS_HOME: '' }
    });

    return { code: result.status, out: result.stdout, err: result.stderr };
}

const greetingIn = (cwd) => JSON.parse(artemisIn(cwd, 'hello', '--json').out).result.greeting;

try {
    fs.mkdirSync(home, { recursive: true });

    const packed = execFileSync('npm', ['pack', '--pack-destination', root, '--json'], {
        encoding: 'utf8'
    });

    const tarball = path.join(root, JSON.parse(packed)[0].filename);

    execFileSync('npm', ['install', '--global', '--prefix', prefix, tarball], { stdio: 'ignore' });

    const a = makeProject('project-a', 'from a');
    const b = makeProject('project-b', 'from b');
    const deep = path.join(a, 'src', 'deep');

    fs.mkdirSync(deep, { recursive: true });

    assert.equal(greetingIn(a), 'from a', 'project a runs its own command');
    assert.equal(greetingIn(b), 'from b', 'project b runs its own command');
    assert.equal(greetingIn(deep), 'from a', 'a folder inside a project finds its project');
    console.log('ok   the installed binary runs the commands of the project it is in');

    const nowhere = fs.mkdtempSync(path.join(root, 'nowhere-'));
    const missing = artemisIn(nowhere, 'hello', '--json');

    assert.equal(missing.code, EXIT_FAILED, 'outside any project it fails');
    assert.equal(JSON.parse(missing.out).ok, false);
    console.log('ok   outside any project it fails with a JSON error and a hint');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
