# SPEC 01 — Artemis in strict TypeScript, published as `@zjaaal/artemis`

> **Status:** Approved
> **Depends on:** none
> **Date:** 2026-11-10
> **Amended:** 2026-11-10 (owner): the package ships its own binary, `art` (also `artemis`). Revised the same day after review: the project is the nearest package.json that is not a marker (a marker says nothing but `type` and has no `commands/` beside it), a package.json that cannot be parsed is always an error, and `@zjaaal/artemis/cli` is a function, `cli({ root })`. See "Amendment: the shipped binary" in the Implementation plan.
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
- **A shipped binary** (amendment): installing the package gives the commands `art` and `artemis` (same file). They find the project through the nearest `package.json` from the current folder that is not a marker (a file that says nothing but `type`, with no `commands/` beside it), and run its commands folder, so a project needs no `bin` file of its own. `@zjaaal/artemis/cli` exports `cli({ root })`, so a project can ship the same CLI under its own command name with a short bin file that runs *its own* commands from wherever the user stands. `run()` stays for full control.
- **Typed args/flags inference in `defineCommand`**: `run({ args, flags })` is typed from the definition (see Data model). All public types are exported, so TypeScript users and JS users with `// @ts-check` get them, even though command files are still `.js`.
- GitHub Actions CI (PRs and `main`) and a tag-triggered release workflow that **stages** the package with an npm token stored as a GitHub secret (`NPM_TOKEN`); the owner approves the staged package with 2FA, and only then is it public.
- Documented manual steps for the owner: storing the `NPM_TOKEN` secret, and approving a staged release (`npm stage approve`).

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

// The shipped binary (amendment, revised after review). Its types live in src/models.ts with the rest of the core.
// What a project may put under the "artemis" key of its package.json. Both fields are optional.
export type ArtemisConfig = {
    commandsDir?: string; // relative to the folder of that package.json; default "commands"
    bin?: string; // the name help and usage lines show; see ResolveBinNameFn for the default
};
// Where the binary found the project: the folder holding the nearest package.json that is not a marker (see FindProjectFn), and its parsed content.
export type Project = { root: string; manifest: Record<string, unknown> };
// How a run got started, which decides the default name: the shipped binary (art, artemis) or a project's own bin file.
export type CliRoute = 'shipped' | 'own';
// The settings a run uses, after defaults. Resolved by a pure function; reading files happens in src/edges/.
export type CliSettings = { bin: string; commandsDir: string }; // commandsDir is absolute
// The project is the nearest package.json that is not a marker. A marker says nothing but "type" and has no commands/ folder beside
// it: the { "type": "module" } file put in src/ or dist/ only to set how .js files are read. Anything else is a package (a name, a
// version, an "artemis" key, "private", or just a commands/ folder beside it). One rule serves both routes: a tool's own package is
// never a marker, so a search that starts at its bin file stops there and never climbs out of node_modules/mytool into the project
// that installed it, whether or not the tool is named, and a marker in dist/ next to the bin file does not stop it early.
export type FindProjectFn = (cwd: string, readManifest: ReadManifestFn, isFolder: IsFolderFn) => Project | undefined; // pure: files are read through the two edges
// What a folder's package.json says: an object, or an error when it cannot be read or is not a JSON object.
export type ManifestRead = { manifest: Record<string, unknown> } | { error: CommandError };
// edge: undefined when dir has no package.json. It never throws for a bad file; it returns the error, and the search throws it:
// a package.json that cannot be read or parsed is always an error naming the file, never skipped, because skipping it would
// silently run the commands of a different project.
export type ReadManifestFn = (dir: string) => ManifestRead | undefined;
export type IsFolderFn = (path: string) => boolean; // edge (the same one discovery uses)
export type ResolveSettingsFn = (project: Project, route: CliRoute) => CliSettings; // throws CommandError with a hint on a bad "artemis" key
export type ResolveBinNameFn = (config: ArtemisConfig, manifest: Record<string, unknown>, route: CliRoute) => string;
//   shipped route: "artemis".bin when set, else "art". A global art shows its own name, never the unrelated CLI a project publishes.
//   own route (cli({ root })): "artemis".bin when set; else the single key of the project's own "bin" object; else, when the project
//   has a "bin" field that does not name one command (a string, or several keys), the package name without its scope (npm names a
//   string bin that way, and a tool with { mytool, mt } is still called after its package); else "art".
// What cli() takes: the host options of run() (streams, interactive, color, env) plus where to look for the project.
export type CliOptions = Pick<RunOptions, 'stdout' | 'stderr' | 'interactive' | 'color' | 'env'> & {
    argv?: string[]; // the command line; default: the arguments of this process, so a bin file does not pass them
    cwd?: string; // shipped route: where to start looking (default: the current folder)
    root?: string | URL; // own route: where the bin file is (import.meta.url); the search starts from its folder, not from the current one
};
export type CliFn = (options?: CliOptions) => Promise<number>; // resolves to the exit code; never calls process.exit
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
  cli/                  the shipped binary (amendment): index.ts (public entry, re-exports `cli`), launch.ts (finds the project and runs it),
                        settings.ts (pure), main.ts (the `art` / `artemis` entry, with the shebang), resolve-hook.ts, their tests
  edges/                the only code that touches the outside world (files, modules, prompts, process)
  utils/                small pure helpers
  test/                 test helpers and the fixture command trees; only tests import from it
  kits/terminal/        index.ts (re-exports only), models.ts, constants.ts, the implementation, its tests
  kits/worktrees/       same, plus its edges (git, lock-edges)
dist/                   build output (git-ignored, published)
package.json  tsconfig.json  tsconfig.build.json  eslint.config.mjs  .prettierrc
AGENTS.md  README.md  LICENSE  docs/CODE_STANDARDS.md  specs/  .claude/skills/ (spec, spec-impl, review-standards)
.github/workflows/ci.yml  .github/workflows/release.yml
```

`package.json` essentials: `"name": "@zjaaal/artemis"`, `"version": "0.1.0"`, `"type": "module"`, `"engines": { "node": ">=22" }`, `"files": ["dist"]`, `"publishConfig": { "access": "public" }`, `exports` for `.`, `./worktrees`, `./terminal` (each with `types` and `import` pointing into `dist/`), `repository` pointing at `zJaaal/artemis`, scripts `build` (`tsc -p tsconfig.build.json`), `test` (`vitest run`), `test:all` (`tsc --noEmit && eslint . && prettier --check . && vitest run`). `vitest.config.ts` sets `passWithNoTests: true` until step 4 so `test:all` passes on an empty `src/`; step 4 removes it. `packageManager` pins the pnpm version (`pnpm@<exact>`, >=7 days old). `prompts` is the only runtime dependency, loaded lazily in `context.ts` only when a command prompts. Amendment: `"bin": { "art": "dist/cli/main.js", "artemis": "dist/cli/main.js" }`, and a fourth export `"./cli": { "types": "./dist/cli/index.d.ts", "import": "./dist/cli/index.js" }`, which exports the function `cli` and does nothing when imported.

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
18. **Release workflow.** `.github/workflows/release.yml`: on tag `v*`, `permissions: { contents: read, id-token: write }` (the second is for the provenance statement), Node 24, `pnpm/action-setup`, `pnpm install --frozen-lockfile`, `test:all`, `build`, `check-exports`, `check-bin`, `check-lock`, check the tag equals `package.json` version, then `npx -y npm@12.2.1 stage publish --provenance --access public` with `NODE_AUTH_TOKEN` taken from `secrets.NPM_TOKEN`. It **stages**, it does not publish: `npm stage` (npm 12, pinned to a version at least a week old) uploads the package without 2FA, with any token type, and creates the package if it does not exist yet, and a person approves it later with 2FA. The token is never written in the repo. The workflow only ever stages, but whether the token itself can publish is decided on npm and cannot be checked from the repository, so the approval gate is only as strong as the token is weak: it must not be able to publish by itself (no 2FA bypass). `ci.yml` also runs the same command with `--dry-run` (`npx -y npm@12.2.1 stage publish --dry-run --provenance --access public`) on Node 24, which satisfies npm 12's Node range (22.22.2+, 24.15+ or 26+), so the command line is checked on every PR; it cannot check the token, which is only exercised by the first tagged release.
19. **Review and PR.** Run `/review-standards`, fix findings, push `spec-01`, open one PR to `main`.

### Amendment: the shipped binary (owner, 2026-11-10; revised after review)

Steps 20 to 24 land on `spec-01` before PR #1 merges, so `0.1.0` is the first release and already has the binary. They are new work, not a revert of commit `490caad` (that design looked for `.artemis/commands` and a user-level folder; this one does not). Its resolve hook is reused as described in step 22.

Revised after review (same day, and again after the third and fourth rounds): the project is the nearest package.json that is not a marker, so a bare `{ "type": "module" }` file no longer stops the search; `@zjaaal/artemis/cli` is a function that takes the location of the bin file, so a published tool runs its own commands instead of the current folder's; a global `art` never shows the name of an unrelated CLI that a project publishes; and a package.json that cannot be parsed is always an error. The rule for which package.json counts is deliberately one rule for both routes, defined by what a marker is, after earlier versions ("has a name", "has an artemis key or commands", a special case for the own route) each fixed one case and broke another. Invariants it has to keep: a tool never runs another package's commands; a marker never stops the search; a broken package.json is never skipped; and every failure says which package.json it used and how to point elsewhere.

How the binary decides what to run:

1. Walk up from the starting folder to the **nearest `package.json` that is not a marker**. A marker is a file that says nothing but `"type"` and has no `commands/` folder next to it (a `{ "type": "module" }` in `src/` or `dist/`, or an empty `{}`); it is skipped. Anything else is a package: a name, a version, `"private"`, an `"artemis"` key, or just a `commands/` folder beside it. The starting folder is the current one for the shipped `art` / `artemis`, and the folder of the bin file for `cli({ root })`. None found: exit 1, `command: null`, error "No project found from <folder> upwards", with a hint for the person running it (a project is the nearest package.json that says more than `type`, with a `commands/` folder next to it) or, on the `cli({ root })` route, for the tool's author (ship package.json and `commands/` in the package, see `files`). The hint names no binary, because the binary does not know what the user typed (`art`, `artemis` or the name of a published tool). **A tool never runs someone else's commands:** its own package is never a marker, named or not, so a search from its bin file stops at that package and never climbs into the project that installed it. **A package that has no commands folder is still the project** and fails with "Commands folder not found", on both routes, instead of silently running a parent's commands; the hint says to create the folder, or to point `"artemis": { "commandsDir" }` at a parent's (for example `"../commands"`), which is how a monorepo package uses the root's commands. This also means a `package.json` that has real content, such as a template or fixture under the project, is a package of its own: run `art` from the project, or point `commandsDir` at the project's commands. **A `package.json` that cannot be read or is not valid JSON is always an error naming the file**, even when it is not the project: running a different project's commands silently is worse than failing, at the cost of a deliberately broken fixture between the current folder and the project making `art` fail until it is run from elsewhere.
2. Read its `"artemis"` key (`ArtemisConfig`) and check it once. Not an object, or a field that is not a non-empty string: exit 1 with the field named and a hint showing the valid shape.
3. `commandsDir` = `"artemis".commandsDir` resolved from the project root, default `<root>/commands`. Missing folder: exit 1, hint "Create <path>, or set \"artemis\": { \"commandsDir\" } in <package.json path>."
4. `bin` = `ResolveBinNameFn` (Data model), from the checked configuration and the route: the shipped binary shows `"artemis".bin`, else `art`; `cli({ root })` shows `"artemis".bin`, else the single key of the project's own `bin` object, else the package name without its scope when the project has a `bin` that does not name one command (a string, or several keys), else `art`.
5. `run(argv, { bin, commandsDir, ... })`, and `process.exitCode` is what it returns. Setup failures above go through the same error reporter as any failure: with `--json` they print `{ ok: false, command: null, error, hint }` on stdout. An unreadable `package.json` (a permission error, a folder with that name) that turns out to be the project is the same kind of failure, with the file named, never a raw stack trace. A `root` that is not a file URL or a path (`import.meta.url` is expected) is also reported this way, with a hint, not thrown.
6. Errors are recognised by their `Symbol.for` tags and not by `instanceof`, so a `CommandError` or `UsageError` thrown by a project's own local copy of Artemis, under a global `art`, keeps its hint, its exit code (1 or 2) and its no-stack-trace behavior. The exit code of a tagged error is only trusted when it is one of the failure codes (1 or 2); anything else, such as a missing value, falls back to 1, so a failed run never exits 0.

Steps:

20. **Settings.** `src/cli/settings.ts`: `findProject`, `resolveSettings`, `resolveBinName`, pure, with `readManifest` and the folder check the only ways to look at the disk (the edges live in `src/edges/files.ts`). Types in `src/models.ts`, the defaults (`"commands"`, `"art"`, the `"artemis"` key) in `src/constants.ts`. The `"artemis"` key is validated once, and the bin name is computed from that validated configuration. Tests beside it cover: the nearest non-marker package.json wins over a parent, a marker is skipped (a bare `type` file or an empty one, in `src/` and in `dist/` next to a tool's bin file), a bare `type` file with a `commands/` folder beside it is a package, an unnamed private package is a package and the search never climbs out of it, a package without commands is the project, a package.json that cannot be parsed is an error even when it is not the project, `commandsDir` resolves from the root and not from the start folder, every bad shape of the key, the search never climbing out of a tool's own package, and the bin name for both routes (config, single `"bin"` key, several keys or a string use the package name, default).
21. **Entry.** `src/cli/main.ts` starts with `#!/usr/bin/env node` (kept by `tsc`) and is the shipped binary: it registers the resolve hook and calls `cli()` with the current folder. `src/cli/index.ts` is the public entry of `@zjaaal/artemis/cli` and only re-exports `cli`; the logic is in `src/cli/launch.ts`, which resolves the settings and calls `run()`. Nothing calls `process.exit`. Setup errors go through the same reporter as every other failure (`CommandError`, `command: null`).
22. **Global installs.** A globally installed `art` runs a project's command files, which `import '@zjaaal/artemis'`. When the project has no local copy, that import must resolve to the running copy: `main.ts` registers a resolve hook (`module.register`, Node >=22) that, only after normal resolution fails with `ERR_MODULE_NOT_FOUND` for `@zjaaal/artemis` or one of its subpaths, resolves it from the running package. A local copy, when present, always wins (the `Symbol.for` tags of commands and of errors keep two copies compatible). Base it on `490caad`'s `src/global/resolve-hook.ts`, changed to fall back instead of always redirecting. `cli({ root })` does not register the hook: a published tool has the framework as its own dependency.
23. **Package and checks.** Add the `bin` field (both names, `dist/cli/main.js`) and the `./cli` export (`dist/cli/index.js`, with types). `scripts/check-exports.mjs` imports `./cli` and checks it exports `cli`. New `scripts/check-bin.mjs`, run by CI after the build: it packs the package and installs it globally into a temp prefix; in temp projects with nothing installed it runs `art` and `artemis` (`help --json`, a command with `--json`, a subfolder, a subfolder holding a bare `{ "type": "module" }` marker, a folder with no project: exit 1, `command: null`), checks that a project publishing an unrelated `bin` still shows `art`, and that a template `package.json` that is valid JSON stops the search with a message that says where else to point. A temp consumer installs the tarball locally (with a tool that has no commands, named and unnamed, and a bin file in `dist/` next to a type marker) and has a bin file `cli({ root: import.meta.url })`: run from an unrelated folder it still runs its own commands and shows its own name (single `bin` key, and the string form), and a command that throws a `CommandError` and a `UsageError` keeps its hint and exit code under the global `art`. `pnpm pack --dry-run` still lists only `dist/`, `README.md`, `LICENSE`, `package.json`.
24. **Docs.** README quick start becomes: install, create `commands/hello.js`, `npx art hello`. A section "Your own command name" shows the bin file with `cli({ root: import.meta.url })` and the `"artemis": { "bin" }` key, and a section "Full control" keeps the `run()` bin file. `AGENTS.md` "Running the CLI" says the same in that order. Both say that `art` and `artemis` are the same command, and what counts as a project.

### Manual steps for the owner (also in the README "Releasing" section)

Agents cannot log in to npm, hold its token or approve a release, so the owner does these:

1. Make sure the `@zjaaal` scope exists on npm (an npm user or organization named `zjaaal`) and that 2FA is on for the account that approves releases.
2. Store the npm token once: `gh secret set NPM_TOKEN --repo zJaaal/artemis`, or Settings, Secrets and variables, Actions, New repository secret, name `NPM_TOKEN`. It only has to stage, and any token type can, so create one that **cannot publish on its own** (no "bypass 2FA"): the approval only protects the owner if the token cannot get around it, and the repository cannot check that. Rotate it before it expires by overwriting the secret.
3. To release, including `0.1.0`: bump `version` in `package.json`, commit, `git tag vX.Y.Z`, `git push origin main vX.Y.Z`. The workflow runs the gate and stages the package with provenance; there is no manual first publish, because staging creates the package when it does not exist.
4. Approve it with npm 12 or newer (it runs on Node 22.22.2+, 24.15+ or 26+; the `npx npm@12.2.1` below brings it): `npx npm@12.2.1 stage list`, `stage view <stage-id>` (or `stage download <stage-id>` to inspect the tarball), then `stage approve <stage-id>` and answer the 2FA prompt. `stage reject <stage-id>` throws a bad one away. A staged version holds its version number, so a rejected version needs a new one.

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
- [ ] `@zjaaal/artemis`, `@zjaaal/artemis/worktrees`, `@zjaaal/artemis/terminal` and `@zjaaal/artemis/cli` resolve through `exports` (`cli` exports a function and does nothing when imported); any other subpath does not.
- [ ] Installing the package puts `art` and `artemis` on the PATH (both `dist/cli/main.js`). In a project with `package.json` and `commands/`, `art hello` runs `commands/hello.js` with no bin file in the project, from the root or any subfolder, including a subfolder that holds a bare `{ "type": "module" }` marker `package.json`.
- [ ] The nearest `package.json` from the current folder that is not a marker (anything but a file that says only `"type"` with no `commands/` beside it) is the project. `"artemis": { "commandsDir" }` moves the commands folder (resolved from that `package.json`'s folder); without it the folder is `commands/`. A package without a commands folder fails with "Commands folder not found" and a hint that also says where else to point, never running a parent's commands.
- [ ] A tool that does not ship its `commands/`, named or not, fails with "Commands folder not found" and a hint for its author, and never runs the commands of the project that installed it, because its own package is never a marker; a `{ "type": "module" }` marker in `dist/` next to its bin file does not end the search early.
- [ ] A `package.json` that cannot be read or parsed is always an error naming the file, never skipped, even when it is not the project; a bad `root` is a reported failure that keeps the reason Node gave, not a stack trace; the exit code of an error from another copy is 1 or 2, never 0.
- [ ] The shipped `art` / `artemis` shows `"artemis".bin` when set, else `art`, and never the name of an unrelated CLI the project publishes. `cli({ root })` shows `"artemis".bin`, else the single key of the project's `bin` object, else the package name without its scope when its `bin` does not name one command (a string, or several keys), else `art`.
- [ ] No project from the starting folder upwards, a missing commands folder, a bad `"artemis"` key, or an unreadable `package.json` exits 1 with a hint that says what to create or set (and never names a binary); under `--json` it is one `{ ok: false, command: null, error, hint }` object.
- [ ] A bin file with `cli({ root: import.meta.url })` gives a project its own command name and runs the project that the bin file belongs to, wherever the user is standing.
- [ ] A globally installed `art` runs a project whose command files import `@zjaaal/artemis` without a local copy; with a local copy, the local one is used, and a `CommandError` or `UsageError` thrown by that local copy keeps its hint and exit code.
- [ ] `scripts/check-bin.mjs` runs in CI after the build and passes.
- [ ] `pnpm pack --dry-run` lists only `dist/`, `README.md`, `LICENSE` and `package.json`.
- [ ] `package.json` has exactly one runtime dependency, `prompts`, and every dev dependency is an exact version. `@types/prompts` is an optional peer dependency (plain JavaScript never needs it).
- [ ] `engines.node` is `>=22`; `package.json` version is `0.1.0`.
- [ ] `AGENTS.md` documents adding a command, the JSON envelope, the exit codes and `--yes`.
- [ ] `README.md` has the tagline, install, quick start and a "Releasing" section with the manual steps.
- [ ] Global flags may be typed before the command name (`art --json math add 1 2`); any other flag before the command is a usage error (exit 2), and a line of only global flags shows help. After `--` everything is a plain argument, and JSON mode is decided from the words before `--`.
- [ ] `--json` never prompts: `ctx.interactive` is false under `--json` and `--yes`. The default hint of a prompt that nobody can answer names `--yes`.
- [ ] A bad `ctx.invoke` call (unknown command, wrong arguments, `--help`) fails the calling command with exit 1 and names the invoked command; it is never a usage error of the outer command line.
- [ ] `defineCommand` rejects a short flag that is not one character and a flag default of the wrong type (a `TypeError`, not a usage error at call time).
- [ ] An alias cannot hide a command, a topic or another alias: it is ignored with a warning.
- [ ] Instance names that look like members of an object (`constructor`) work like any other name; a tab id that is not a plain word (letters, digits, `-`, `_`) is refused before anything is written or opened.
- [ ] The registry lock never exposes an empty file (content is written before the file appears), a stale lock is taken over by one process at a time and only if it still holds what was judged stale, an empty or unreadable lock gets a grace period, and a lock is released only if it is still the holder's. `pnpm run check-lock` races real processes against the built package and every one gets its own slot.
- [ ] `ci.yml` runs on PRs and `main` for Node 22 and 24, and runs the release command with `--dry-run` (same flags, including `--provenance`) on Node 24; `release.yml` runs on `v*` tags, uses `id-token: write` for provenance, reads the npm token only from `secrets.NPM_TOKEN` (no token value in the repo), and **stages** the package with `npm stage publish` instead of publishing it, so nothing is public until the owner approves it with 2FA.
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
- **Yes:** `bin` required in `run()`. A library should not assume the consumer is called `art`. The shipped binary passes its own resolved name, so `run()` keeps no default.
- **Yes:** types for `defineCommand` definitions. Cheap, and agents get editor feedback on what a definition may hold.
- **Yes:** typed args/flags inference in `defineCommand`, with every public type exported (owner, 2026-11-10). Agents writing tools get compiler feedback from the definition alone, and JS users get it through `// @ts-check` and the `.d.ts`. Runtime behavior is unchanged: inference is types only.
- **Yes:** `.claude/skills` ships in the public repo (owner, 2026-11-10): contributors and agents get the same spec workflow. The skills hold no machine paths (checked).
- **Yes:** `AGENTS.md` and a README in this spec. Agents are the audience, and the guide is the cheapest way to make the contract usable.
- **Yes:** metaphor (arrow, quiver) only in README branding. API, `help` and errors keep `command` and `topic`.
- **No:** TypeScript command files. Loading `.ts` needs a loader or a build step in the consumer; later spec.
- **No:** store kit now. `stateFile` stays so this spec moves nothing but language and packaging.
- **Yes:** CI on Node 22 and 24 (current LTS and the next); Node 20 is not supported.
- **Yes:** tag-triggered release that **stages** with an npm token kept as the GitHub secret `NPM_TOKEN`, and a person approving with 2FA (owner, 2026-11-10: "the token is for staging"). Changed from trusted publishing (OIDC) and then from publishing in CI: the owner prefers a token, which needs no trusted-publisher setup, and wants proof-of-presence on every release. npm 12's `npm stage publish` is exactly that: CI stages without 2FA, any token type works, and `npm stage approve` publishes after 2FA. The cost is a secret to rotate and one human step per release; releases still get provenance. The gate is only as strong as the token is weak: the token must not be able to publish by itself, which npm decides and the repository cannot verify.
- **No:** Changesets or semantic-release. One maintainer and one package; a tag is enough.
- **Yes:** the owner stores the npm token and approves staged releases. Agents cannot log in to npm, hold the token or approve. There is no manual first publish: staging creates the package when it does not exist, so `0.1.0` is a tagged, staged and approved release like any other.

- **Yes:** `@types/prompts` is an optional peer dependency (owner, 2026-11-10), because the public types mention `PromptObject` and plain JavaScript users never need the types.
- **Yes:** the package ships a binary (owner, 2026-11-10, reversing the earlier "No"). "Drop one file in a folder and get a CLI command" is the point of the project; asking for a bin file first breaks that promise. Earlier the same day a binary based on `.artemis/commands` and a user-level folder was built (`490caad`) and reverted (`c44b17f`); that design is not revived.
- **Yes:** `@zjaaal/artemis/cli` is a function, `cli({ root })`, not a side-effect import (review, 2026-11-10). A side-effect import cannot know which bin file imported it, so a published tool would run the commands of whatever project the user stands in. The bin file passes its own location.
- **Yes:** the shipped binary's name never comes from the project's own `bin` field (review, 2026-11-10): a project that publishes an unrelated CLI `foo` and uses `art` for its dev commands must see `art`. Only `cli({ root })` reads the project's own `bin`.
- **Yes:** the project is the nearest package.json that is not a marker (review, 2026-11-10, settled after four rounds). A marker says nothing but `type` and has no `commands/` beside it. The rule is defined by what a marker is, not by qualification heuristics ("has a name", "has an artemis key or commands", an own-route special case), each of which fixed one case and broke another. A tool's own package is never a marker, so a search from its bin file stops there; a package.json that cannot be parsed is always an error. Known cost, accepted: a package.json with real content under the project (a template, a fixture) is a package of its own, and a deliberately broken one between the current folder and the project makes `art` fail; the messages name the package.json that was used and how to point at another commands folder.
- **Yes:** the project is the nearest `package.json`, configured by an optional `"artemis": { "commandsDir", "bin" }` key, default `commands/` (owner, 2026-11-10). Works from any subfolder, needs no config file of its own, and an unrelated `commands/` folder higher up is never picked by mistake. Folders are never merged: one run, one commands folder.
- **Yes:** the binary is named `art` and `artemis`, two names for one file (owner, 2026-11-10). `art` matches the docs; `artemis` is the fallback when another `art` is on the PATH. npm bin names are not scoped, so a clash is possible; the package name `@zjaaal/artemis` is unaffected.
- **Yes:** `@zjaaal/artemis/cli` for a project's own command name (owner, 2026-11-10). npm fixes a package's bin names, so a user cannot rename `art`; a one-line bin file that imports `./cli` gives the same CLI any name, and the name shown in help follows the project's `"bin"` key.
- **No:** a user-level commands folder (`~/.artemis/commands`) or an `ARTEMIS_COMMANDS` override. A folder is already a scope; the nearest project is enough. A later spec can add one if a real need appears.

## Risks

| Risk | Mitigation |
| --- | --- |
| Rewrite drifts from the JS behavior | Tests are ported first; step 15 compares the `help --json` manifest against the scripts repo's build; differences are listed in the PR as bugs. |
| Discovery loads `.js` fixtures but sources are `.ts` | Fixtures stay `.js` under `src/test/fixtures/`, excluded from `tsc` build and from lint type rules; discovery loads whatever is on disk through `import()`. |
| Dev dependency versions copied from Falcon are not on npm or younger than 7 days | Check each with `pnpm view <pkg> time` before pinning; on a miss, stop and report. |
| The first tagged release fails to stage (expired or wrongly scoped token, missing secret, scope not owned on npm) | `npm publish --dry-run` and `npm stage publish --dry-run` run in CI on every PR; the release workflow runs the full gate before it stages; nothing is public until the owner approves, so a bad staged version is rejected (`npm stage reject`) and re-released under a new number. |
| A token that can publish (2FA bypass) makes the approval step decorative | The workflow only ever runs `npm stage publish`, the README and the manual steps say to create the token without 2FA bypass, and the limitation is stated plainly: what a token may do is decided on npm and cannot be checked from the repository. |
| Worktrees tests depend on the machine's git config | Temp repos set `user.name`, `user.email` and `init.defaultBranch` explicitly; no global config is read. |
| Lock takeover tests are timing-sensitive | Time and process liveness come in as injectable options; no sleeps in tests. |
| Another tool named `art` is on the user's PATH | `artemis` is the same command; README says so. |
| A global `art` and a project's local copy differ in version | The local copy wins when present (step 22); the runtime `Symbol.for` tags keep definitions and errors from either copy recognized, so a hint and an exit code survive the boundary. |
| The resolve hook changes how other packages resolve | It acts only on `@zjaaal/artemis` specifiers and only after normal resolution failed; every other specifier goes through untouched (tested). |
| Importing `./cli` in a check runs the CLI | `check-exports.mjs` only resolves `./cli`; the CLI is exercised by `check-bin.mjs` in temp folders. |
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
- Publishing: the owner approves each staged release (`npm stage approve`) and creates the `NPM_TOKEN` secret by hand.

Each one, if it lands, goes in its own spec.
