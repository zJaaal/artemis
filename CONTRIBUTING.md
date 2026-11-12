# Contributing

## Working on Artemis itself

- Read `docs/CODE_STANDARDS.md` first. It is binding: types in `models.ts`, constants in `constants.ts`, no magic numbers, no enums, no `any`, pure logic with side effects at the edges (`src/edges/`), no nested loops, JSDoc on exports, tests per section 7.
- `pnpm run test:all` runs `tsc`, `eslint`, `prettier --check` and `vitest` (type tests included). It must pass before a change is done. `pnpm run build` emits `dist/`, and `pnpm run check-exports` verifies the package entry points after a build, `pnpm run check-bin` runs the packed `art` and `artemis` in temporary projects, and `pnpm run check-lock` races real processes for the registry lock.
- Specs live in `specs/`. Work follows the spec: if something looks wrong, change the spec, not the code by surprise.
- Tests sit beside their source (`foo.ts` and `foo.test.ts`). Test helpers and the fixture command trees are in `src/test/` and only tests import from there. One case per test, no branching around assertions, no snapshots, fake only the edges (clock, prompts, terminal), never our own modules.

## Releasing

- A release is a PR that bumps `version` in `package.json`. When it merges, the Release workflow runs the checks, stages the package on npm (`npm stage publish --provenance`) and tags the merged commit `v<version>`. A merge that leaves the version alone stages nothing.
- Nothing is public until the owner approves the staged package with 2FA: `npx -y npm@12.2.1 stage approve @zjaaal/artemis@<version>`.
- If staging fails, re-run the workflow: the tag is only pushed after a successful stage.
