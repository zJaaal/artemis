# Code Standards

Binding rules for all code in Artemis: strict TypeScript, ES modules, Node 22+.

**A review comment is a rule for the whole codebase, not a note on one file.** When one is found, fix every
occurrence.

## 1. Files have one job

| Kind                                                           | Where                                                | Never                      |
| -------------------------------------------------------------- | ---------------------------------------------------- | -------------------------- |
| Types and interfaces                                           | `models.ts` (module or root)                         | Inline in a logic file     |
| Constants                                                      | `constants.ts` (module or root)                      | Inline literals in logic   |
| Pure logic                                                     | `utils/<topic>` or a module's pure file              | Mixed with I/O             |
| Side effects (files, processes, git, terminal, clock, prompts) | One small edge module each (see §7)                  | Called directly from logic |
| The public API                                                 | `src/index.ts` and each kit's entry: re-exports only | Logic in an entry file     |

An entry file only re-exports. A module that both decides and does I/O is two modules.

## 2. Types

- **Reuse types.** One shape, one declaration; derive the rest (`Pick`, `Omit`, `Parameters`).
- **No enums.** Use `as const` objects and derive the union:

    ```ts
    export const EXIT_CODE = { OK: 0, FAILED: 1, USAGE: 2 } as const;
    export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];
    ```

- No `any`. Use `unknown` and narrow. No `as unknown as` to force a type.
- Let TypeScript infer obvious types; annotate parameters, return types of exported functions and the public
  API.

## 3. No magic numbers

Every number that means something gets a named constant with a unit in its name: `LOCK_TIMEOUT_MS`,
`LOCK_POLL_MS`, `SLOT_PORT_STEP`, `MAX_INSTANCE_NAME_LENGTH`. This covers durations, ports, sizes, thresholds,
exit codes, ANSI codes and list lengths.

Allowed literals: `0`, `1`, `-1` as index/identity, `100` for percent conversion, and array positions.

## 4. Readability

- **No nested loops.** Index or group first (a lookup keyed by id), then do one pass.
- **Name conditions.** A boolean with more than two terms becomes a well-named helper (`isTopicOnly(words, length)`).
- **No dense one-liners.** Break chained ternaries into an early-return helper.
- **Pass objects, not spread fields.**
- Functions do one thing and fit on a screen.
- Comments explain _why_; JSDoc on every exported function.

## 5. Performance

- Don't rebuild static data in a loop or on every call: compute it once at module level.
- Index once, then look up; don't filter a list per item.
- Load heavy or optional dependencies lazily (`await import('prompts')` only when a command prompts).

## 6. Errors and lifecycle

- **No silent noops.** A `catch {}` needs a named reason (`ignoreAlreadyRemoved`) or a comment saying why
  nothing is lost.
- Expected failures are `CommandError` with a `hint` that says how to fix the call; the command line being
  wrong is `UsageError`. A plain `Error` means a bug.
- Locks, temporary files and child processes are released in `finally`.
- Never call `process.exit` from library code: return an exit code.

## 7. Testable by design, and tested

Every change ships with its tests.

Vitest, with `foo.ts` → `foo.test.ts` in the same folder. Test-only helpers and fixture command trees live in
`src/test/`, and only tests import from it.

### Code shaped for tests

- **Utils are pure.** No filesystem, processes, environment, `Date.now()` or `Math.random()` inside them. Time
  comes in as a `now` parameter, the environment as an `env` parameter. Utils return data; the caller prints it.
- **Side effects live at the edges.** The filesystem, child processes (git, docker, `open`), process liveness,
  the clock, the terminal and prompts each sit behind one small module (or an injectable option, as the kits'
  `open` and `env` do). Nothing else calls them directly, so a test fakes that one module.
- **`run()` takes its world as options** (`stdout`, `stderr`, `interactive`, `color`, `env`), so a test passes
  sinks and asserts what was written and the exit code.

### How a test is written (binding)

**One case per test, stated in its title.** No `if`, `switch`, ternary or loop around assertions. ESLint rejects
it (`vitest/no-conditional-in-test`, `vitest/no-conditional-expect`).

```ts
// Wrong: two cases, and which one runs depends on the data
test('exit code', async () => {
    const code = await art(argv);
    if (argv.includes('--bad')) expect(code).toBe(2);
    else expect(code).toBe(0);
});

// Right: one case each, named
test('an unknown flag is a usage error', async () => {
    expect(await art(['hello', '--bad'])).toBe(EXIT_CODE.USAGE);
});
```

**Tables are fine** when every row is its own named case with its own expected value (`test.each` with
`$name`). A table never computes its expected values from its input.

**Constants, never copies.** Thresholds and codes are asserted through their named constant
(`EXIT_CODE.USAGE`, `basePort + SLOT_PORT_STEP`), never as `2` or `8180`.

**Fake only the edges, with realistic data.**

- **The edges are:** the clock, prompts and the TTY, child processes we can't run in a test (Warp's `open`),
  and the `stdout`/`stderr` sinks.
- **Real, never faked:** our own modules, the filesystem in a temporary folder, `git` in a temporary repo,
  Node's argument parser. If a test needs one of our modules faked, refactor the code so its edge can be faked
  instead.
- **A fake returns fixed realistic data or records calls.** It never computes the answer the test then asserts.

**Real inputs.** Real-looking command trees (fixture folders of command files), real worktree layouts
(`git worktree add` in a temporary repo). Invented values only for opaque ids.

**No snapshots.** Assert the text, field or exit code a caller depends on.

**Never weaken a test to pass.** No skipped or focused tests in a commit (`vitest/no-disabled-tests`,
`vitest/no-focused-tests`). An expectation changes only when the behavior change is intended, and the PR says
why. A flaky test is a bug: find its hidden input (time, order, shared state, a shared temp folder) and fix it.

**A bug a test finds is fixed.** Fix the code in the same change, keep the test as the proof, and list it in the
PR description under "Bugs found by tests" (module, case, before → after).

## 8. Formatting and lint

Prettier, enforced by ESLint (`eslint-plugin-prettier`):

```json
{
    "printWidth": 100,
    "tabWidth": 4,
    "singleQuote": true,
    "trailingComma": "none",
    "bracketSameLine": true,
    "arrowParens": "always"
}
```

**Code reads in paragraphs.** Prettier keeps blank lines but never adds them, so ESLint adds them
(`eslint.spacing.cjs`) and `eslint --fix` applies them:

- a blank line before a `return` that isn't alone in its block;
- a blank line after a run of `const`/`let` declarations;
- a blank line before and after a multi-line block (`if`, `for`, `while`, `try`, `switch`), call or declaration;
- braces always (`curly: all`): never `if (x) a(); else b();`.

ESLint also rejects `any` (`@typescript-eslint/no-explicit-any`) and enums (`no-restricted-syntax` on
`TSEnumDeclaration`) in TypeScript.

## 9. Dependencies

- Every new dependency is justified in its spec. Prefer Node's standard library.
- Versions are exact and at least 7 days old when added.
- Artemis ships with the fewest runtime dependencies possible (today: `prompts`, loaded lazily). Everything
  else is a dev dependency.

## Review checklist

Run before every PR (the `review-standards` skill automates it):

- [ ] Types in `models`, constants in `constants`; no magic numbers, no enums, no `any`
- [ ] Entry files only re-export; logic is pure where it can be
- [ ] No nested loops, no unnamed long conditions, no long one-liners
- [ ] No silent catches; locks, temp files and children released in `finally`
- [ ] Side effects behind edge modules; utils take `now`/`env` as parameters
- [ ] Every changed module has tests next to it, written per §7 (one case, no branching, edges only, constants,
      no snapshots)
- [ ] Bugs found by tests are fixed and listed in the PR description
- [ ] `pnpm run test:all` passes (tsc, lint, format, tests)
