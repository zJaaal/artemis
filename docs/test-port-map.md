# Test port map (spec 01, steps 4 and 5)

Old `node:test` title in the scripts repo -> new Vitest case(s). Test files are named by module and live in that module's folder (`run/run.test.ts`, `kits/worktrees/lock.test.ts`, ...). Each old test is one or more single-case
Vitest tests, because the standards allow one case per test. Deleted in step 19; the PR description carries it.

## `test/artemis.test.js` (24 tests)

| Old title                                                            | New case(s)                                                                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| a top-level file is a command named after the file                   | `run.test.ts` same title; `discover.test.ts` same title                                                                 |
| a folder is a topic: "topic command" runs the file inside it         | `run.test.ts` same title; `discover.test.ts` a file inside a folder is a command named after the folder path            |
| "topic:command" is accepted as the same command                      | `run.test.ts` same title; `resolve.test.ts` same title                                                                  |
| aliases resolve to their command                                     | `run.test.ts` same title; `resolve.test.ts` a declared alias resolves to its command                                    |
| files starting with an underscore are not commands                   | `run.test.ts` same title; `discover.test.ts` same title; `resolve.test.ts` same title                                   |
| positional args map in order and fall back to their default          | `parse.test.ts` positional args map in order; an omitted positional falls back to its default                           |
| boolean flags with a short form are parsed                           | `parse.test.ts` same title                                                                                              |
| repeatable string flags collect every value                          | `parse.test.ts` same title                                                                                              |
| a missing required arg is a usage error that shows the usage         | `run.test.ts` same title; `parse.test.ts` a missing required arg is a usage error; a usage error carries the usage line |
| a value outside the allowed choices is a usage error that lists them | `run.test.ts` same title; `parse.test.ts` same title                                                                    |
| extra positionals and unknown flags are usage errors                 | `run.test.ts` extra positionals are a usage error; unknown flags are a usage error; `parse.test.ts` same two            |
| an unknown command suggests the closest match                        | `run.test.ts` same title; `resolve.test.ts` the closest name is suggested for a likely typo                             |
| a CommandError exits 1 and reports its hint                          | `run.test.ts` same title                                                                                                |
| with --json an error is a JSON object on stdout                      | `run.test.ts` same title                                                                                                |
| with --json, ctx.log output is suppressed so stdout stays parseable  | `run.test.ts` same title (now asserts the whole envelope)                                                               |
| prompting when not interactive fails with a hint instead of hanging  | `run.test.ts` same title; the fixture `ask.js` now passes a hint naming `--yes`                                         |
| ctx.invoke runs another command and returns its result               | `run.test.ts` same title                                                                                                |
| help lists topics and top-level commands with descriptions           | `help.test.ts` same title                                                                                               |
| no arguments shows help                                              | `help.test.ts` same title                                                                                               |
| naming only a topic lists the commands inside it                     | `help.test.ts` same title                                                                                               |
| "topic help" lists the commands inside the topic                     | `help.test.ts` same title                                                                                               |
| --help on a command shows its args, defaults, choices and flags      | `help.test.ts` same title                                                                                               |
| help --json returns a manifest an agent can read                     | `help.test.ts` same title, plus the manifest pins                                                                       |
| a file that does not export a command is skipped with a warning      | `run.test.ts` same title; `discover.test.ts` same title                                                                 |

## `test/terminal.test.js` (4 tests) -> `src/kits/terminal/warp.test.ts`

| Old title                                                                    | New case(s)                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the warp adapter writes a Tab Config split left/right and opens it by its id | writes a Tab Config named after the tab, with its color; splits a flat list of panes left to right; writes the commands and the focus of a pane; opens a tab through its warp:// link, by id |
| a single-pane tab has no split node                                          | same title; remove deletes the Tab Config                                                                                                                                                    |
| a layout tree nests splits: two panes on top, one across the bottom          | same title; the root comes first; a pane inside a split keeps its directory and commands; the focused pane of a layout is marked                                                             |
| a layout that is a single pane needs no split node                           | same title                                                                                                                                                                                   |

## `test/worktrees.test.js` (18 tests) -> `src/kits/worktrees/worktrees.test.ts` and `lock.test.ts`

| Old title                                                                             | New case(s)                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| outside any checkout, the main worktree is current                                    | same title                                                                                                                                                                           |
| inside the main checkout, the main worktree is current                                | same title                                                                                                                                                                           |
| a worktree without a registration refuses, with a hint                                | same title                                                                                                                                                                           |
| ensure registers the worktree it runs in, named after its folder, on the next slot    | registers the worktree it runs in, named after its folder, on the next slot; ensuring again returns the same instance; current finds the registered worktree from a folder inside it |
| a folder name that is already taken gets a numeric suffix                             | same title                                                                                                                                                                           |
| an explicit name taken by another worktree is a usage error                           | same title                                                                                                                                                                           |
| ensure accepts a root from elsewhere, and rejects a folder that is not a checkout     | accepts a root from elsewhere; rejects a folder that is not a checkout                                                                                                               |
| the env variable overrides the folder, and an unknown name fails                      | overrides the folder; an unknown name fails                                                                                                                                          |
| a repo that is not a checkout of the app counts as outside one                        | same title                                                                                                                                                                           |
| remove frees the slot for the next worktree, and the main one cannot be removed       | frees the slot for the next worktree; the main worktree cannot be removed                                                                                                            |
| a detached instance belongs to no checkout, gets the next slot and keeps its metadata | belong to no checkout, get the next slot and keep their metadata; can be read back by name                                                                                           |
| ensuring a detached instance again returns it, with updated metadata                  | ensuring again returns the same slot, with updated metadata; ensuring again does not register a second instance                                                                      |
| the folder never resolves to a detached instance; the env variable can                | the folder never resolves to a detached instance; the env variable can resolve to a detached instance                                                                                |
| a detached name cannot reuse a worktree instance, an invalid name, or the main name   | three cases: reuse a worktree instance; must be valid; cannot be the main name                                                                                                       |
| removing a detached instance frees its slot                                           | same title                                                                                                                                                                           |
| registrations from many processes at once all survive, each with its own slot         | a registration that waited for the lock does not overwrite the one made while it waited (deterministic, injected clock and liveness; no child processes)                             |
| a registration waits while another live process holds the registry lock               | `lock.test.ts` same title                                                                                                                                                            |
| a lock left by a process that died is taken over                                      | `lock.test.ts` same title                                                                                                                                                            |

## New cases (not ports)

`define.test.ts` (every validation of `defineCommand`, with the JS messages), the manifest pins in
`help.test.ts`, the JSON envelope cases in `run.test.ts`, `resolve.test.ts` and `discover.test.ts` extras,
`names.test.ts`, and the remaining `lock.test.ts` and kit cases. Context tests (`--yes`, lazy `prompts`) arrive in
step 9.
