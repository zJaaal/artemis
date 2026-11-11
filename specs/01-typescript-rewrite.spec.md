# SPEC 01 — Artemis in strict TypeScript, published as `@zjaaal/artemis`

> **Status:** Approved
> **Depends on:** none
> **Date:** 2026-11-10
> **Objective:** Move Artemis out of the scripts repo into a new public repo as a strict TypeScript, ESM-only npm package with identical behavior, ported tests and CI/release set up.

## Why this spec exists

Artemis exists so AIs can write their own CLI tooling: an agent drops one file in a folder and gets a command. The contract an agent relies on is machine-readable:

- `help --json` prints a manifest of every command with its args, flags, defaults, allowed values and examples.
- With `--json`, every call prints one object on stdout: `{ "ok": true, "command", "result" }` or `{ "ok": false, "command", "error", "hint" }`.
- Exit codes are 0 (success), 1 (the command failed), 2 (the command line was wrong).
- `--yes` never prompts. A prompt in a non-interactive run throws an error whose hint names the flag to pass.

Today this lives as plain JS in the private scripts repo (`command/`, 1237 lines, 46 `node:test` tests). To be useful to other people's agents it needs its own public repo, types, a build and a published package. The bar is **behavior parity**: the rewrite changes the language and the packaging, not what the CLI does.

The tagline and the arrow/quiver metaphor are branding only (README intro). The API, `help` and error text keep plain terms: `command`, `topic`.

## Scope

**In:**

- New public repo `zJaaal/artemis`, fresh history (nothing from the scripts repo's commits).
- Rewrite of `command/` (core: define, discover, parse, resolve, help, run, context, errors, index) and `command/kits/` (`worktrees`, `terminal`) in strict TypeScript under `src/`.
- **Code standards from Project Millennium Falcon, binding on every file:** `docs/CODE_STANDARDS.md` is Falcon's `docs/frontend/CODE_STANDARDS.md` without the React and mobile parts. Types in `models.ts`, constants in `constants.ts`, no magic numbers, no enums, no `any`, pure utils with side effects at the edges, no nested loops, named conditions, code in paragraphs (spacing lint), JSDoc on exports, tests per §7. Where the adapted file is silent, Falcon's original `docs/frontend/CODE_STANDARDS.md` (private repo; the main session pastes the relevant section into the delegation brief) applies. A straight port that breaks a rule is not done: the rewrite applies them.
- Port of the 46 existing tests to Vitest first, rewritten per `docs/CODE_STANDARDS.md` §7, with the fixture command trees under `src/test/`.
- Package `@zjaaal/artemis` 0.1.0: ESM only, Node >=22, plain `tsc` build to `dist/` (JS + `.d.ts`), subpath exports `@zjaaal/artemis/worktrees` and `@zjaaal/artemis/terminal`.
- Lint and format as in Falcon's `packages/protocol`: typescript-eslint, prettier, `eslint.spacing.cjs`, vitest rules, no `any`, no enums.
- Cheap agent-facing changes: `bin` required in `run()`; `AGENTS.md`; `README.md`.
- **A global `artemis` binary** (added 2026-11-10, owner: needed to ship): `npm install --global @zjaaal/artemis` gives an `artemis` command that runs from any folder. It loads exactly one commands folder per run (see "Global binary" below), so several projects on one machine stay isolated.
- **Typed args/flags inference in `defineCommand`**: `run({ args, flags })` is typed from the definition (see Data model). All public types are exported, so TypeScript users and JS users with `// @ts-check` get them, even though command files are still `.js`.
- GitHub Actions CI (PRs and `main`) and a tag-triggered release workflow that publishes with an npm token stored as a GitHub secret (`NPM_TOKEN`).
- Documented manual steps for the owner: first publish, creating the npm token and storing it as the `NPM_TOKEN` repository secret.

**Out of scope (for future specs):**

- Store kit (state documents, atomic writes, locks, migrations). The worktrees kit keeps taking `stateFile`.
- TypeScript command files (discovery still loads `.js` only).
- `scaffold` / `check` commands for agents.
- Result schemas in the `help --json` manifest.
- MCP adapter.
- Shell completion.
- Topic aliases and per-topic default commands.
- Migrating the scripts repo to the package (separate spec in that repo).
- Replacing the runtime symbol tags with shape validation in discovery (a behavior change, not needed for parity).

## Data model

No new data structures at runtime. The public API keeps its shape and gains types. Names below are the contract; exact field types follow the current JS (`command/define.js` JSDoc).

```ts
// src/models.ts: every type of the core lives here, function types included, as named aliases.
// Logic files (define.ts, run.ts, context.ts...) import them and hold no type declarations of their own.
export type FlagDefinition = {
    type: 'boolean' | 'string';
    short?: string;
    multiple?: boolean;
    default?: boolean | string | string[];
    choices?: string[];
    description?: string;
};

export type ArgDefinition = {
    name: string;
    description?: string;
    required?: boolean;
    default?: string;
    choices?: string[];
};

// The ctx a command receives (from the current command/context.js). `ctx.yes` and `ctx.bin` do not exist today and are not added.
export type CommandContext = {
    json: boolean;
    interactive: boolean;
    style: Style; // color helpers; shape follows the current `style`
    log: LogFn; // stdout, suppressed under --json
    warn: LogFn; // stderr, always
    prompt: PromptFn;
    commands: Command[]; // every discovered command
    invoke: InvokeFn; // runs another command, inherits --json and --yes
};

// Function typings are aliases too, never inline in a signature:
export type LogFn = (...parts: unknown[]) => void;
export type PromptFn = (questions: PromptObject | PromptObject[], options?: PromptOptions) => Promise<Record<string, unknown>>;
export type PromptOptions = { hint?: string };
export type InvokeFn = (id: string, argv?: string[]) => Promise<unknown>;
export type RunFn<TArgs, TFlags> = (input: RunInput<TArgs, TFlags>) => unknown | Promise<unknown>;
export type DefineCommandFn = <
    const TArgs extends readonly ArgDefinition[] = [],
    const TFlags extends Record<string, FlagDefinition> = {}
>(definition: CommandDefinition<TArgs, TFlags>) => Command<TArgs, TFlags>;
export type DefineTopicFn = (definition: TopicDefinition) => TopicDefinition;
export type IsCommandFn = (value: unknown) => value is Command; // checks the runtime tag, as today
export type IsTopicFn = (value: unknown) => value is TopicDefinition;
export type RunCliFn = (argv: string[], options: RunOptions) => Promise<number>; // the exit code

export type RunInput<TArgs, TFlags> = { args: InferArgs<TArgs>; flags: InferFlags<TFlags>; ctx: CommandContext };

export type CommandDefinition<
    TArgs extends readonly ArgDefinition[] = readonly ArgDefinition[],
    TFlags extends Record<string, FlagDefinition> = Record<string, FlagDefinition>
> = {
    description: string;
    run: RunFn<TArgs, TFlags>;
    args?: TArgs;
    flags?: TFlags;
    aliases?: string[];
    examples?: string[];
    [extra: string]: unknown; // extra fields pass through untouched (the dotCMS `step` convention)
};

// Trade-off, accepted: the index signature keeps the `step` pass-through (behavior parity) but means a typo in a
// definition field (`descripton`) is not a type error. Known fields are still typed and required fields are enforced.

// No brand in the type: a `unique symbol` would differ between two loaded copies and break their type compatibility.
// The runtime tag stays (parity); the type is the definition itself.
export type Command<TArgs = readonly ArgDefinition[], TFlags = Record<string, FlagDefinition>> = CommandDefinition<TArgs, TFlags>;
export type TopicDefinition = { description: string; [extra: string]: unknown }; // field types follow command/define.js

// Inference: args and flags are declared `as const`-friendly (const type parameters), and run() sees
//   args:  required or defaulted -> string; optional -> string | undefined; with choices -> their union
//   flags: boolean -> boolean | undefined (boolean with default -> boolean);
//          string -> string | undefined (default -> string; choices -> their union);
//          multiple: true -> string[] | undefined (with a default -> string[]; choices -> array of their union)
//   an arg with both default and choices -> the union; a boolean flag ignores choices
//   a definition not declared `as const` widens: choices -> string, and required/optional follow the declared booleans
// RunOptions, RunInput, Command and the helper types below are all exported from models.ts too.
export type RunOptions = {
    bin: string; // now required: no "art" default
    commandsDir: string;
    stdout?: Writable;
    stderr?: Writable;
    interactive?: boolean;
    color?: boolean;
    env?: NodeJS.ProcessEnv;
};
export type CommandErrorOptions = { hint?: string };
// Exported helpers: InferArgs<TArgs>, InferFlags<TFlags>, RunInput<TArgs, TFlags>, Command, CommandContext

// Logic files only implement the aliases above (the brand symbols are `Symbol.for(...)` values kept in constants.ts):
// src/define.ts   export const defineCommand: DefineCommandFn = ...;  export const defineTopic: DefineTopicFn = ...;
// src/define.ts   export const isCommand: IsCommandFn = ...;  export const isTopic: IsTopicFn = ...;  (same Boolean(value?.[TAG]) check as the JS)
// src/run.ts      export const run: RunCliFn = ...;
// src/errors.ts   export class CommandError extends Error { hint?: string }   // classes are values, they stay in errors.ts
//                 export class UsageError extends Error { hint?: string }
// Kits follow the same rule: src/kits/models.ts holds the option, result and function types of both kits.
```

Conventions:

- Exit codes live in one constant: `EXIT_CODE = { OK: 0, FAILED: 1, USAGE: 2 }`.
- The `help --json` manifest keeps its current shape, field names and order. A test pins it (asserting the fields a caller depends on, no snapshot).
- `Symbol.for('artemis.command')` and `Symbol.for('artemis.topic')` are kept at runtime, so two loaded copies still recognize each other's definitions, and discovery's bad-definition check behaves as in the JS. They are not part of the TypeScript types.
- Types and function typings live only in `models.ts` (core) and `kits/models.ts` (kits), per CODE_STANDARDS; no logic file declares a `type` or `interface`, and no function signature spells an inline function type. A lint rule or the review-standards pass checks it.
- Exported types of `src/index.ts`: `defineCommand`, `defineTopic`, `CommandError`, `UsageError`, `run`, `EXIT_CODE`, plus the definition and options types above.

Package layout:

```
src/                    index.ts (re-exports only), models.ts, constants.ts: the shared public types and constants
  define/ errors/ parse/ resolve/ discover/ context/ help/ run/
                        one folder per module: its source, its foo.test.ts (and foo.test-d.ts) beside it
  edges/                the only code that touches the outside world (files, modules, prompts, process)
  utils/                small pure helpers
  global/               the global `artemis` binary: bin.ts (wiring only), main.ts, locate.ts, resolve-hook.ts
  test/                 test helpers and the fixture command trees; only tests import from it
  kits/terminal/        index.ts (re-exports only), models.ts, constants.ts, the implementation, its tests
  kits/worktrees/       same, plus its edges (git, lock-edges)
dist/                   build output (git-ignored, published)
package.json  tsconfig.json  tsconfig.build.json  eslint.config.mjs  .prettierrc
AGENTS.md  README.md  LICENSE  docs/CODE_STANDARDS.md  specs/  .claude/skills/ (spec, spec-impl, review-standards)
.github/workflows/ci.yml  .github/workflows/release.yml
```

`package.json` essentials: `"name": "@zjaaal/artemis"`, `"version": "0.1.0"`, `"type": "module"`, `"engines": { "node": ">=22" }`, `"files": ["dist"]`, `"publishConfig": { "access": "public" }`, `exports` for `.`, `./worktrees`, `./terminal` (each with `types` and `import` pointing into `dist/`), `repository` pointing at `zJaaal/artemis`, scripts `build` (`tsc -p tsconfig.build.json`), `test` (`vitest run`), `test:all` (`tsc --noEmit && eslint . && prettier --check . && vitest run`). `vitest.config.ts` sets `passWithNoTests: true` until step 4 so `test:all` passes on an empty `src/`; step 4 removes it. `packageManager` pins the pnpm version (`pnpm@<exact>`, >=7 days old). `prompts` is the only runtime dependency, loaded lazily in `context.ts` only when a command prompts.

## Implementation plan

Step 1 is on `main`; the rest are commits on `spec-01`. Each step leaves the repo runnable and `pnpm run test:all` green from step 2, except steps 4 and 5 (ported tests red against stubs, by design) until the sources land in steps 6 to 13.

1. **Repo scaffold.** `git init`, `.gitignore` (`node_modules`, `dist`), commit what the folder already holds (LICENSE, `docs/CODE_STANDARDS.md`, `eslint.spacing.cjs`, `specs/`, `.claude/skills`) and this spec as the first commit on `main`. Then `gh repo create zJaaal/artemis --public`, push `main`, branch `spec-01`.
2. **Tooling.** `package.json`, `tsconfig.json` (copy Falcon's protocol: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; `module`/`moduleResolution` `NodeNext`, `types: ["node"]`), `tsconfig.build.json` (excludes `*.test.ts` and `src/test/`, emits to `dist/` with declarations), `eslint.config.mjs`, `.prettierrc` (from CODE_STANDARDS §8). Dev deps at the exact versions of Falcon's protocol (`typescript` 6.0.3, `typescript-eslint` 8.72.0, `eslint` 9.39.5, `prettier` 3.9.10, `vitest` 4.1.12, `@vitest/eslint-plugin` 1.6.27, `eslint-config-prettier` 10.1.8, `eslint-plugin-prettier` 5.5.7) plus `@types/node` and `@types/prompts` (exact, each >=7 days old). Add `packageManager` and a `.npmrc`-free pnpm setup (no workspace file). `pnpm install`, commit `pnpm-lock.yaml`. `pnpm run test:all` passes on an empty `src/`.
3. **Fixtures and test helpers.** Copy `test/fixtures/commands` and `bad-commands` from the scripts repo checkout (read-only source) into `src/test/fixtures/` (still `.js` files, since discovery loads `.js` only). Add `src/test/` helpers: a `run` wrapper with in-memory `stdout`/`stderr` sinks, a temp-folder helper, a temp git repo helper.
4. **Port the core tests.** Remove `passWithNoTests`. Rewrite the cases of `test/artemis.test.js` as Vitest files beside their future sources (`parse.test.ts`, `resolve.test.ts`, `discover.test.ts`, `help.test.ts`, `run.test.ts`, `define.test.ts`), one case per test, `EXIT_CODE` constants, no snapshots. To keep `tsc` passing, this step also adds typed stubs that throw `not implemented`. The suite is red for the right reason, so this commit is the one exception to "test:all is green".
5. **Port the kit tests.** Same for `test/worktrees.test.js` and `test/terminal.test.js` (`worktrees.test.ts`, `terminal.test.ts`), using real temp git repos and `git worktree add`. Add stubs. Total ported cases: 46. Keep the old title next to each new case in `docs/test-port-map.md` (old title -> new title, generated while porting) and paste it in the PR description; delete the file in step 19.
6. **Errors, constants, define.** Implement `errors.ts`, `constants.ts` (`EXIT_CODE` and every other named number), `define.ts` with the types of the Data model, including the args/flags inference and its type tests (`define.test-d.ts`, Vitest `typecheck` enabled in `vitest.config.ts`). Their tests go green.
7. **Parse and resolve.** Implement `parse.ts` and `resolve.ts` against the ported tests.
8. **Discover.** Implement `discover.ts` (loads `.js` files with dynamic `import()`, `_topic.js`, `_` private prefix, duplicate and bad-definition errors) against its tests.
9. **Context.** Implement `context.ts` (log, `--yes`, lazy `prompts`, the non-interactive throw with a hint).
10. **Help.** Implement `help.ts` (text help and the `help --json` manifest) against its tests.
11. **Run and index.** Implement `run.ts` (injectable `stdout`, `stderr`, `interactive`, `color`, `env`; JSON envelope; exit codes) with `bin` required, and `index.ts`. Core tests all green.
12. **Terminal kit.** Implement `kits/terminal/` (tabs as data, layout tree, Warp adapter, injectable `open`).
13. **Worktrees kit.** Implement `kits/worktrees/` (slots, ports, colors, env override, registry lock with dead-process takeover, `stateFile` option) with the real-git tests.
14. **Build and exports.** `pnpm run build`; check `dist/` has `.js` and `.d.ts` for `.`, `./worktrees`, `./terminal`. Add `scripts/check-exports.mjs`, run by CI after `build`: it imports all three entry points through the package name (self-reference by `exports`) and asserts any other subpath fails to resolve. Verify `pnpm pack --dry-run` lists only `dist`, `README.md`, `LICENSE`, `package.json`.
15. **Parity check.** Run the ported fixture CLI and the scripts repo's `art help --json` (scripts repo path from the brief) against the new build (read-only, scripts repo untouched): compare the manifest shape. Record any difference as a bug in the PR.
16. **Docs.** `AGENTS.md` (how an agent adds a command: file location, `defineCommand` example, the JSON contract, exit codes, `--yes`, prompts throw with hints when non-interactive, `help --json`) and `README.md` (tagline, metaphor as branding, install, quick start, kits, "Releasing" section with the manual steps below).
17. **CI.** `.github/workflows/ci.yml`: on `pull_request` and push to `main`, matrix Node 22 and 24, `pnpm/action-setup` (version from `packageManager`), `pnpm install --frozen-lockfile`, `pnpm run test:all`, `pnpm run build`, `node scripts/check-exports.mjs`, `npm publish --dry-run`.
18. **Release workflow.** `.github/workflows/release.yml`: on tag `v*`, `permissions: { contents: read, id-token: write }` (the second is for the provenance statement), Node 24, `pnpm/action-setup`, `pnpm install --frozen-lockfile`, `test:all`, `build`, check the tag equals `package.json` version, `npm publish --provenance --access public` with `NODE_AUTH_TOKEN` taken from `secrets.NPM_TOKEN` (publish stays on the npm CLI, which provenance needs). The token is never written in the repo.
19. **Review and PR.** Run `/review-standards`, fix findings, push `spec-01`, open one PR to `main`.
20. **Global binary** (added after the PR was opened). `src/global/` (constants, models, `locate.ts`, `resolve-hook.ts`, `main.ts`, `bin.ts`), `bin` in `package.json`, `scripts/check-bin.mjs` run by CI and the release workflow, README and AGENTS sections.

### Manual steps for the owner (also in the README "Releasing" section)

Agents cannot log in to npm, so the owner does these once:

1. Merge the PR. On a machine logged in to npm (`npm login`, account that owns the `@zjaaal` scope), from a clean checkout of `main`: `pnpm install --frozen-lockfile && pnpm run test:all && pnpm run build && npm publish --access public`. This creates `@zjaaal/artemis@0.1.0`. (Provenance is not available for a local publish; later releases get it.)
2. On npmjs.com create a granular access token that can publish `@zjaaal/artemis` (read and write, limited to that package, with an expiry you will remember), then store it as the repository secret: `gh secret set NPM_TOKEN --repo zJaaal/artemis`, or Settings, Secrets and variables, Actions, New repository secret, name `NPM_TOKEN`.
3. For each later release: bump `version` in `package.json`, commit, `git tag vX.Y.Z`, `git push origin main vX.Y.Z`. The workflow publishes with provenance.
4. Rotate the token before it expires: create a new one and overwrite the `NPM_TOKEN` secret.

## Global binary

Added to this spec on 2026-11-10 because the package has to ship with a command people can run anywhere. Behavior stays that of the library: the binary only decides which commands folder `run()` gets, and calls it with `bin: 'artemis'`.

**Which commands folder.** Exactly one per run, the first that exists, in this order:

1. `ARTEMIS_COMMANDS`, if set: a path, relative to the current folder. It is used even if it does not exist, so a wrong value shows up as a warning instead of silently loading something else.
2. The nearest `.artemis/commands`, looking in the current folder and then each parent up to the root of the disk. Nested projects: the nearest wins.
3. The user-level folder `~/.artemis/commands`, or `commands` under `ARTEMIS_HOME` if that is set.

Folders are **never merged**. This is the answer to "several Artemis projects on one machine": each project only sees its own commands, a user-level folder is the fallback outside any project, and nothing leaks between projects. Layering project and user commands is a possible later spec.

**Nothing found.** The run fails with exit code 1 and a `CommandError` whose message names where it looked and whose hint says to create `.artemis/commands` or set `ARTEMIS_COMMANDS`; under `--json` it is the usual `{ ok: false, command: null, error, hint }`.

**Importing the framework from a command file.** A command file does `import { defineCommand } from '@zjaaal/artemis'`, but a global install is not on the module path of a project's files. The binary registers a module resolution hook (`node:module` `register`) that resolves `@zjaaal/artemis` and its subpaths from inside the running package, so command files get the same copy that runs them and nothing is installed in the project. The runtime `Symbol.for` tags still tolerate two copies.

**Binary name.** `artemis`. (Apache ActiveMQ Artemis also ships an `artemis` command; if both are on a machine's PATH, the one installed later wins. The package name is scoped, so npm itself has no clash.)

Files: `src/global/bin.ts` (wiring only, `package.json` `bin`), `main.ts`, `locate.ts` (pure; folder existence is injected), `resolve-hook.ts`, each with its test. `scripts/check-bin.mjs` packs the package, installs the tarball globally into a temporary prefix and runs the real binary in temporary projects that have nothing installed.

## Acceptance criteria

- [ ] `pnpm run test:all` passes (tsc, eslint, prettier, vitest) on Node 22 and on Node 24.
- [ ] The Vitest suite contains the 46 ported cases, each with one named case per test, and the PR lists the old-to-new title map.
- [ ] `pnpm-lock.yaml` is committed, `package.json` has `packageManager` with an exact pnpm version, and no `package-lock.json` exists.
- [ ] No test uses `if`/`switch`/ternary/loop around assertions, snapshots, `.skip` or `.only`.
- [ ] No `any`, no `enum`, no `// @ts-ignore` in `src/`.
- [ ] `type` and `interface` declarations exist only in `models.ts` files (and `*.test-d.ts` for type tests); function types are named aliases there.
- [ ] `src/` has no `process.exit` call; `run()` returns the exit code.
- [ ] `run()` without `bin` fails type-checking; there is no `"art"` default.
- [ ] Type tests (`expectTypeOf`, in `define.test-d.ts` run by Vitest's typecheck) pin the inference: a required arg is `string`, an optional one `string | undefined`, an arg or flag with `choices` is the union of its choices, a boolean flag is `boolean | undefined`, a flag with a default is not `undefined`, a `multiple` flag is `string[] | undefined` (`string[]` with a default), an arg with `default` and `choices` is the union, and reading an undeclared arg or flag is a type error.
- [ ] `InferArgs`, `InferFlags`, `RunInput`, `Command`, `CommandDefinition`, `CommandContext`, `ArgDefinition`, `FlagDefinition` and `RunOptions` are exported from `@zjaaal/artemis`, and the kits' option and result types from their subpaths.
- [ ] A fixture command tree run with `--json` prints `{ ok: true, command, result }` on success and `{ ok: false, command, error, hint }` on failure.
- [ ] Exit codes are 0 for success, 1 for a failed command, 2 for a wrong command line, asserted through `EXIT_CODE`.
- [ ] `help --json` on the fixture tree lists every command with name, description, args, flags, defaults, choices and examples, same field names as the JS version.
- [ ] A command that prompts, run with `--yes`, never prompts; run non-interactively without `--yes`, it fails with a hint naming `--yes`.
- [ ] `prompts` is not imported when no command prompts (asserted by a test).
- [ ] `defineCommand` rejects reserved flags (`help`, `json`, `yes`, `-h`, `-y`) and a required arg after an optional one, with the same messages as the JS version.
- [ ] Two concurrent `ensure` calls in the worktrees kit get different slots.
- [ ] The worktrees kit still takes `stateFile` and refuses unregistered worktrees.
- [ ] `ci.yml` also runs `scripts/check-exports.mjs` and `npm publish --dry-run` after the build.
- [ ] `pnpm run build` emits `dist/index.js`, `dist/index.d.ts`, `dist/kits/worktrees.js`, `dist/kits/terminal.js` and their `.d.ts`.
- [ ] `@zjaaal/artemis`, `@zjaaal/artemis/worktrees` and `@zjaaal/artemis/terminal` resolve through `exports`; any other subpath does not.
- [ ] `pnpm pack --dry-run` lists only `dist/`, `README.md`, `LICENSE` and `package.json`.
- [ ] `package.json` has exactly one runtime dependency, `prompts`, and every dev dependency is an exact version. `@types/prompts` is an optional peer dependency (plain JavaScript never needs it).
- [ ] `package.json` has `bin: { artemis }` pointing at `dist/global/bin.js`, which keeps its shebang after the build.
- [ ] The global command loads the nearest `.artemis/commands` from the current folder upwards, falls back to the user-level folder, honors `ARTEMIS_COMMANDS` and `ARTEMIS_HOME`, never merges folders, and two projects on one machine run only their own commands (asserted by tests).
- [ ] With nothing found it fails with exit code 1, a message that says where it looked, and a hint; under `--json` it is the failure object.
- [ ] `pnpm run check-bin` passes: the packed package, installed globally, runs `hello` in two projects that have nothing installed, from a nested folder too, and fails cleanly outside any project.
- [ ] `engines.node` is `>=22`; `package.json` version is `0.1.0`.
- [ ] `AGENTS.md` documents adding a command, the JSON envelope, the exit codes and `--yes`.
- [ ] `README.md` has the tagline, install, quick start and a "Releasing" section with the manual steps.
- [ ] `ci.yml` runs on PRs and `main` for Node 22 and 24; `release.yml` runs on `v*` tags, uses `id-token: write` for provenance, and reads the npm token only from `secrets.NPM_TOKEN` (no token value in the repo).
- [ ] `.claude/skills/` is committed in the public repo (it is not in the published package: `files` is only `dist`), and no file in the repo holds an absolute local path (a grep for the home-directory prefix of the owner machine finds nothing).
- [ ] The repo history starts at step 1 and holds no commit from the scripts repo.

## Decisions

- **Yes:** new public repo with fresh history. The scripts repo's commits carry paths and machine setup that must not go public.
- **Yes:** package name `@zjaaal/artemis`. Plain `artemis`, `art`, `artemis-cli` and `quiver` are taken on npm; a scoped name cannot clash.
- **Yes:** publish 0.1.0 to npm now. Agents and the scripts repo can then depend on a real package; 0.x signals the API may still move.
- **Yes:** strict TypeScript, ESM only, Node >=22. Node 20 is EOL, and ESM-only avoids the dual-package problem.
- **Yes:** plain `tsc` to `dist/` (JS + `.d.ts`). The source needs no bundling, and fewer tools means fewer dependencies to age-check.
- **No:** `tsup` or any bundler. The earlier README plan named it; subpath exports work from `tsc` output alone.
- **Yes:** subpath exports for the kits, so apps that do not need them do not load them.
- **Yes:** `prompts` stays the only runtime dependency, lazy-loaded.
- **Yes:** dev dependencies at exact versions at least 7 days old, same versions as Falcon's protocol package for the shared tools.
- **Yes:** pnpm as package manager (owner, 2026-11-10), same as Falcon. One package, no workspace file. Publishing still uses the npm CLI, because provenance is an npm feature.
- **Yes:** Vitest. Port the 46 tests first, then rewrite the source against them, so parity is proven and not assumed.
- **Yes:** lint as in Falcon (typescript-eslint, prettier, spacing rules, vitest rules, no `any`, no enums), enforced by `pnpm run test:all`.
- **Yes:** behavior parity is the bar: same CLI output, `help --json` shape, errors, hints and exit codes, same kits API.
- **Yes:** `bin` required in `run()`. A library should not assume the consumer is called `art`.
- **Yes:** types for `defineCommand` definitions. Cheap, and agents get editor feedback on what a definition may hold.
- **Yes:** typed args/flags inference in `defineCommand`, with every public type exported (owner, 2026-11-10). Agents writing tools get compiler feedback from the definition alone, and JS users get it through `// @ts-check` and the `.d.ts`. Runtime behavior is unchanged: inference is types only.
- **Yes:** `.claude/skills` ships in the public repo (owner, 2026-11-10): contributors and agents get the same spec workflow. The skills hold no machine paths (checked).
- **Yes:** `AGENTS.md` and a README in this spec. Agents are the audience, and the guide is the cheapest way to make the contract usable.
- **Yes:** metaphor (arrow, quiver) only in README branding. API, `help` and errors keep `command` and `topic`.
- **No:** TypeScript command files. Loading `.ts` needs a loader or a build step in the consumer; later spec.
- **No:** store kit now. `stateFile` stays so this spec moves nothing but language and packaging.
- **Yes:** CI on Node 22 and 24 (current LTS and the next); Node 20 is not supported.
- **Yes:** tag-triggered release publishing with an npm token kept as the GitHub secret `NPM_TOKEN` (owner, 2026-11-10). Changed from trusted publishing (OIDC): the owner prefers a token, which needs no trusted-publisher setup on npm and works from the first tagged release. The cost is a secret to rotate; a granular token limited to this package keeps the exposure small. Releases still get provenance.
- **No:** Changesets or semantic-release. One maintainer and one package; a tag is enough.
- **Yes:** first publish and the npm token done by the owner. Agents cannot log in to npm or hold the token, so the owner publishes `0.1.0` by hand and stores `NPM_TOKEN`; later releases are tags.

- **Yes:** a global `artemis` binary in this spec (owner, 2026-11-10: needed to ship), loading one commands folder per run: `ARTEMIS_COMMANDS`, else nearest `.artemis/commands` upwards, else `~/.artemis/commands`. Never merged, so projects stay isolated.
- **Yes:** a module resolution hook so command files import `@zjaaal/artemis` from the running copy. The alternative (a symlinked `node_modules` per project, or an `init` command) leaves state in every project and can drift from the running version.
- **No:** layering project and user commands, an `artemis init` scaffold, shell completion for the global binary. Later specs.
- **Yes:** `@types/prompts` is an optional peer dependency (owner, 2026-11-10), because the public types mention `PromptObject` and plain JavaScript users never need the types.

## Risks

| Risk | Mitigation |
| --- | --- |
| Rewrite drifts from the JS behavior | Tests are ported first; step 15 compares the `help --json` manifest against the scripts repo's build; differences are listed in the PR as bugs. |
| Discovery loads `.js` fixtures but sources are `.ts` | Fixtures stay `.js` under `src/test/fixtures/`, excluded from `tsc` build and from lint type rules; discovery loads whatever is on disk through `import()`. |
| Dev dependency versions copied from Falcon are not on npm or younger than 7 days | Check each with `pnpm view <pkg> time` before pinning; on a miss, stop and report. |
| The first tagged release fails (expired or wrongly scoped token, missing secret) | The manual first publish is documented; `npm publish --dry-run` runs in CI on every PR; the release workflow runs the full gate before it publishes; the first tagged release can be a patch bump. |
| Worktrees tests depend on the machine's git config | Temp repos set `user.name`, `user.email` and `init.defaultBranch` explicitly; no global config is read. |
| Lock takeover tests are timing-sensitive | Time and process liveness come in as injectable options; no sleeps in tests. |
| A module resolution hook is a young Node API (`module.register`) | It is covered by a unit test and by `check-bin`, which installs the real tarball; the hook only touches this package's own name. |
| Package scope `@zjaaal` not owned on npm | Owner confirms before step 1 of the manual steps; if missing, the owner creates the scope (free for public packages). |

## Handoff

- **Runs in:** the artemis checkout via `/spec-impl 01 delegated`. The brief gives the absolute path of the scripts repo checkout (read-only, used by steps 3 and 15) and, if needed, the Falcon standards text; neither path is written into this repo.
- **Reads first:** `docs/CODE_STANDARDS.md` (Falcon's standards, binding) and, for anything it leaves open, Falcon's original `docs/frontend/CODE_STANDARDS.md`. Every step follows them; `/review-standards` runs before the PR.
- **May:** `git init`; commit each step on `spec-01` (the scaffold commit of step 1 on `main` first); `gh repo create zJaaal/artemis --public`; push `main` and `spec-01`; open one PR to `main`.
- **Must not:** merge, `npm publish`, touch the scripts repo (read-only access to its `command/` and `test/` is fine, at the path the brief gives), add a dependency the spec doesn't name.
- **Stops and reports when:** a step needs a decision the spec doesn't make; a check fails twice.
- **Reports:** steps done, PR link, commands run with results, open questions, bugs found by tests.

## What is **not** in this spec

- Store kit (documents, atomic writes, locks, migrations): its own spec.
- TypeScript command files.
- `scaffold` and `check` commands for agents.
- Result schemas in the manifest.
- MCP adapter, shell completion, topic aliases.
- Migrating the scripts repo to the package (separate spec in that repo).
- Publishing: the owner does the first `npm publish` and creates the `NPM_TOKEN` secret by hand.

Each one, if it lands, goes in its own spec.
