# Handoff

State on 2026-11-12: specs 01 to 03 are built. What is left is below: ideas for later specs, and the name and metaphor notes. The specs in [`specs/`](../specs/) are the record of what was built and why.

## Ideas worth building

-   An MCP adapter: `help --json` already lists every command with its args and flags, which maps directly to
    MCP tools (name, description, input schema), so the same command folder could serve both people and agents.
-   Shell completion generated from the same data.
-   Topic aliases (e.g. `exp` for `experiments`) and per-topic default commands.
-   For agents writing their own tools: a `scaffold` command, result schemas in the manifest, and
    TypeScript command files.

## Name and metaphor (draft, to polish)

**Artemis**, goddess of the hunt: the framework hunts down your commands. It walks a folder and
finds every command in it, with no list to keep up to date.

-   **Arrow** = a command: one file, one arrow (`commands/uve/config/set.js`).
-   **Quiver** = a folder: it holds arrows and other quivers (what the code calls a topic).
-   **`art`** = the CLI this repo builds on it.

Tagline ideas: "Drop an arrow in the quiver, get a command." / "Artemis: drop a file, get a
command."

Naming notes:

-   The plain npm names are taken (`artemis`, `art`, `artemis-cli`, `quiver`), so publish as
    `@zjaaal/artemis`; a scoped name cannot clash.
-   "Artemis" is crowded in search: the NASA program, and Apache ActiveMQ Artemis (a Java message
    broker), which matters if it is ever pitched to Java people. A clear tagline carries the
    meaning the name does not.
-   Use the metaphor for branding only: the README intro, the tagline, a logo. The API, help and
    error text keep plain terms (`command`, `topic`, `_topic.js`, "Unknown command"). People
    already know those from other CLIs and frameworks, so they need no translating. Those
    messages are read by someone who is already confused. The metaphor breaks on nesting (a
    quiver does not hold quivers, but topics nest). And agents reading `help --json` understand
    the plain terms without explanation.

