# Yep Anywhere Agent Instructions

This is the canonical entry point for repository agent instructions.
`CLAUDE.md` imports this file; Gemini and Cursor point directly to it.

Before planning implementation or making repository changes, read and follow
[DEVELOPMENT.md](DEVELOPMENT.md), including for documentation and configuration
changes. Read the applicable topic documents before choosing an approach.
General discussion and read-only orientation do not require the full
development workflow; the topic triggers below still apply when relevant.

When `AGENTS.local.md` exists here, it is the machine-local final-authority
amendment to these instructions: read it before acting in this repo — it
defines request verbs such as `push` and `publish` and their standing
constraints. A clone without the file loses nothing.

Before planning or implementing new work, search both `tasks/` and the
relevant enclosing `gaps/` directories for pending defects, follow-ups, or
already-planned work. Read and cite matches before defining a new task. A gap
is not generic authorization to expand scope; follow `gaps/README.md`,
including deleting an entry in the commit that closes it.

For product priorities, read the [Roadmap](docs/roadmap/README.md) before
proposing or reprioritizing work. It is the canonical initiative overview;
linked tactical plans and topic docs supply implementation detail and
contracts. Keep its status and blockers current when roadmap work changes.
Roadmap priority does not expand the scope of an unrelated user request.

The working tree may contain concurrent human or agent edits. Avoid reverting
or tidying unrelated changes unless the task directly requires them.

## Topic Triggers

These are reading triggers; the linked contributor sections and topic docs
own the detailed requirements, exceptions, commands, and approval procedures.

- **Architecture, stability, performance, or security:** start at
  [ARCHITECTURE.md](ARCHITECTURE.md) before deriving an approach. Check its
  existing proposals, cleanup tables, and trigger conditions; read the linked
  detail and surface existing trade-offs before changing a load-bearing path.
- **Background loops, watchers, polling, retries, heartbeats, liveness,
  reconnects, or catch-up:** read
  [architecture mandates](topics/architecture-mandates.md). Idle provider
  sessions and closed client tabs must not indefinitely consume server resources.
- **Client/server contract changes:** follow the
  [compatibility review](DEVELOPMENT.md#clientserver-compatibility-review),
  [server capabilities](topics/server-capabilities.md), and
  [hosted compatibility](topics/remote-hosted-compatibility.md) before editing.
  Present the release corpus, gate, and missing-gate fallback for maintainer
  approval; an originating request approving those decisions satisfies the pause.
- **Deployment-sensitive defaults, configuration precedence, endpoints,
  provider/model settings, migrations, or maintainer deploy configuration:**
  read [hard development rules](topics/hard-development-rules.md).
- **YA-managed writes in a project or its Git metadata:** read
  [project directory storage](topics/project-directory-storage.md).
  App-data-only remains the default; project-local writes require explicit
  global opt-in.
- **Provider session IDs:** preserve the
  [YA-visible session identity](DEVELOPMENT.md#provider-session-identity).
- **New user-visible behavior:** read
  [vanilla defaults](topics/vanilla-defaults.md) before adding or enabling
  behavior that is not configurable default-off. Use only documented exceptions.
- **UI proposals or mockups:** read [UI design](topics/ui-design.md) before
  selecting fixtures, rendering, or export commands. Respect prose-only requests
  and the user's visual-verification handoff.
- **UI tweaks or browser verification:** follow
  [visual verification](DEVELOPMENT.md#ui-tweak-visual-verification) and
  [UI testing](topics/ui-testing.md). Final desktop/phone captures use a fresh
  server unless the user explicitly takes visual review or skips captures.
- **Client styles or components with legacy global classes:** read
  [CSS architecture](topics/css-architecture.md) and the
  [contributor CSS workflow](DEVELOPMENT.md#client-css).
- **Client copy or console output:** follow
  [i18n readiness](DEVELOPMENT.md#client-i18n) and
  [console chatter](topics/console-chatter.md). Client work includes the
  contributor guide's console scan.
- **Performance measurements:** read
  [performance regression evidence](topics/performance-regression-suite.md)
  and [measurement-host requirements](DEVELOPMENT.md#performance-measurement-hosts)
  before treating benchmarks as regression evidence.
- **Codex provider or protocol work:** follow
  [reference source](DEVELOPMENT.md#reference-source) and the
  [version bump audit](DEVELOPMENT.md#codex-version-bump-audit). A read-only
  preliminary audit may proceed immediately; obtain approval before enacting
  compatibility changes unless already authorized.
- **Finishing implementation:** verify every intentional observable behavior
  has a contract in the owning topic, following
  [observable behavior contracts](DEVELOPMENT.md#observable-behavior-contracts).

## Agent Commit Conventions

Do not add assistant co-author trailers or generated-with banners. Preserve
explicitly required provenance such as `Contributing-model:` when applicable;
that trailer is not a generated-with banner.

Before committing, follow the contributor guide's
[warning-free checks](DEVELOPMENT.md#zero-warning-commits) and
[commit message guidance](DEVELOPMENT.md#commit-message-guidance), including
its originating-instruction synthesis and series-threading requirements.
