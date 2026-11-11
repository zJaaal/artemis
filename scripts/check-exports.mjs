// Run after `pnpm run build`. Imports every entry point through the package name (a self-reference
// resolved by `exports`) and checks that nothing else in the package can be imported.
import assert from 'node:assert/strict';

const ENTRY_POINTS = {
    '@zjaaal/artemis': [
        'defineCommand',
        'defineTopic',
        'CommandError',
        'UsageError',
        'run',
        'EXIT_CODE'
    ],
    '@zjaaal/artemis/worktrees': ['defineWorktrees', 'toWorktreeName'],
    '@zjaaal/artemis/terminal': ['warp', 'openTabs']
};

// Importing the CLI entry runs the CLI, so it is only resolved, never imported.
const RESOLVE_ONLY = ['@zjaaal/artemis/cli'];

const HIDDEN_PATHS = [
    '@zjaaal/artemis/package.json',
    '@zjaaal/artemis/dist/index.js',
    '@zjaaal/artemis/define',
    '@zjaaal/artemis/worktrees/lock',
    '@zjaaal/artemis/kits/worktrees',
    '@zjaaal/artemis/cli/main',
    '@zjaaal/artemis/dist/cli/main.js'
];

const NOT_EXPORTED = 'ERR_PACKAGE_PATH_NOT_EXPORTED';

async function checkEntry([specifier, names]) {
    const entry = await import(specifier);

    names.forEach((name) => assert.ok(name in entry, `${specifier} does not export ${name}`));
    console.log(`ok   ${specifier}`);
}

function checkResolves(specifier) {
    const url = import.meta.resolve(specifier);

    assert.match(url, /\/dist\/cli\/main\.js$/, `${specifier} should resolve to the CLI entry`);
    console.log(`ok   ${specifier} resolves (and is not imported: it runs the CLI)`);
}

async function checkHidden(specifier) {
    const failure = await import(specifier).then(
        () => undefined,
        (error) => error
    );

    assert.equal(failure?.code, NOT_EXPORTED, `${specifier} should not resolve`);
    console.log(`ok   ${specifier} is not exported`);
}

await Promise.all(Object.entries(ENTRY_POINTS).map(checkEntry));
RESOLVE_ONLY.forEach(checkResolves);
await Promise.all(HIDDEN_PATHS.map(checkHidden));
