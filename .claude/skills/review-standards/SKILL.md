---
name: review-standards
description: Review code and its tests against the owner's code standards (docs/CODE_STANDARDS.md) and fix findings across the whole codebase. Use before opening or updating a PR, at the end of /spec-impl, after a refactor, or when the owner asks to check style, magic numbers, types, file layout or tests.
---

# Review against the code standards

The owner reviews every PR. **A finding is a rule, not a line: fix every occurrence in the codebase, not only the
one you found.**

## 1. Load the rules

Read `docs/CODE_STANDARDS.md` in full. It is binding; §7 is how tests are written.

## 2. Scope

- Default: the branch diff against `main` (`git diff main...HEAD --stat`, plus uncommitted changes).
- If the owner says "whole codebase": every source folder (`src/`, or `bin/`, `lib/` and `commands/`)
  and the tests.

## 3. Mechanical scan (fast signals, then read the code)

```bash
pnpm run test:all   # types (tsc or JSDoc check), eslint, prettier --check, vitest
# Types declared outside models files (TypeScript)
grep -rnE "^(export )?(type|interface) " src --include=*.ts | grep -v "models.ts"
# JSDoc typedefs outside models files (JavaScript)
grep -rn "@typedef" lib commands bin | grep -v "models.js"
# Enums
grep -rn "enum " src --include=*.ts
# Number literals in logic (review each hit; 0/1/-1 and 100-percent are fine)
grep -rnE "[^A-Za-z_\.][0-9]{2,}(\.[0-9]+)?[^0-9A-Za-z_%]" src lib commands bin --include=*.ts --include=*.js \
    | grep -v "constants\.\|models\.\|\.test\."
# Silent catches
grep -rnE "catch *(\([a-z_]*\))? *\{ *\}" src lib commands bin
# Changed source files without a test next to them (review each: pure wiring and index files may be exempt)
git diff --name-only main...HEAD -- '*.ts' '*.js' | grep -vE '\.(test|models|constants)\.(ts|js)$|/index\.(ts|js)$|/test/|\.config\.' \
    | while read f; do t="${f%.*}.test.${f##*.}"; [ -f "$t" ] || echo "no test: $f"; done
# Snapshots and mocks of our own modules in tests
grep -rn "toMatchSnapshot\|toMatchInlineSnapshot" src lib commands test 2>/dev/null
grep -rnE "vi\.mock\('\.\.?/" src lib commands test 2>/dev/null
```

## 4. Read for what grep can't see

For each changed module and command:

- **Size and job:** a command only wires (reads args/flags, calls `lib/`, returns data). Logic and conditions with
  more than two terms belong in named helpers.
- **Readability:** nested loops, chained ternaries, long one-liners, cryptic names (`t`, `b`, `s`, `idx` outside
  tiny lambdas), missing blank lines between paragraphs of code.
- **Types:** reused, not re-declared; no `any`, no `as unknown as`. In JS: JSDoc on every export.
- **Purity:** utils take `now` and `env` as parameters and never touch the filesystem, processes or the clock.
- **Edges:** files, child processes, prompts, terminal and network each go through one small module or an
  injectable option.
- **Errors and lifecycle:** no silent catches; `CommandError` with a hint for expected failures; locks, temp
  files and children released in `finally`; no `process.exit` in library code.
- **Tests (§7):** every changed module has a test next to it. Each test states one case in its title, with no
  `if`/`switch`/ternary/loop around assertions. Codes and thresholds are asserted through constants. Only edges
  are faked, with realistic data. No snapshots. A bug a test found is fixed in the code, and the PR description
  lists it under "Bugs found by tests".

## 5. Report, then fix

List findings grouped by **rule** (not by file), each with every location. Then fix them all, run step 3 again
until clean. Behavior must not change in a standards fix; call out anything that does.
