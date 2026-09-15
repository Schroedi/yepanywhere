# Plannotator integration is unscoped

YA has no first-class path for [Plannotator](https://github.com/backnotprop/plannotator)
(local browser review for agent plans, markdown, diffs, and HTML artifacts).
The product is real and widely integrated with the same harnesses YA supervises,
but this checkout has never used it. What follows is research, not a design.

## What Plannotator does

It is a local review surface that plugs into the agent through **hooks,
skills, and slash commands**, not through YA:

- **Plan review.** Claude `ExitPlanMode` / OpenCode `submit_plan` / Pi
  `plannotator_submit_plan` opens a browser UI. The user annotates, then
  approve / deny-with-feedback / approve-with-notes. Deny returns structured
  comments as the agent's next input; a later resubmit shows a plan diff.
- **Annotate.** `/plannotator-annotate <file|dir|url>`,
  `/plannotator-last` (last agent message), HTML via `--render-html`.
- **Code review.** `/plannotator-review` on the working tree or a GitHub/GitLab
  URL. Comments go back to the agent.
- **HTML artifacts.** Rendered HTML can be annotated in the browser. Adjacent
  Visual HTML skills live at https://github.com/plannotator/effective-html.

Install is per-harness (`plannotator` CLI plus hooks/skills in `~/.claude`,
Codex Stop hook, OpenCode plugin, `pi install npm:@plannotator/pi-extension`,
etc.). Sessions need those host files, not a YA setting, to open a review.

## Overlap with YA

- **Artifact serving.** YA already isolates interactive HTML under a configured
  artifact origin (`topics/active-content-security.md`). Plannotator is a
  *review and feedback* app over plans/HTML/diffs, not a file server. A YA
  session that writes `plan.md` or a prototype `.html` could be opened in
  either surface. They should not both claim the same localhost port.
- **Source review.** YA's Source Control review comments are git-line comments
  into a YA session. Plannotator review comments are agent-turn feedback. Same
  human gesture, different delivery.
- **Remote executors / SSH.** Plannotator has `PLANNOTATOR_REMOTE` and a fixed
  port for SSH/devcontainers. YA remote executors would need that port
  forwarded if a remote harness is the one opening reviews.
- **Browser.** Plannotator opens its own local server and a system browser.
  YA already has a session-scoped browser. Unclear whether reviews should open
  in YA's browser, the OS browser, or both.

## What a YA integration might do (unconfirmed)

None of this is approved:

- Brief sessions (capability fragment or a `/plannotator` command) on how to
  submit plans/HTML that Plannotator can render, and how to treat returned
  annotation text as user steering.
- A session or provider checkbox that only documents the expectation, or that
  sets `PLANNOTATOR_*` in the child environment.
- A button that runs `/plannotator-last` or opens the last plan/HTML artifact
  through Plannotator if the CLI is on PATH.
- Generate prototype artifacts in a layout Plannotator's HTML annotator
  understands, served either by Plannotator or by YA's artifact origin.

The crux is ownership of the feedback loop: Plannotator already injects the
next user turn into the *provider* session. YA would see that as an incoming
user message. Do not add a second injector that duplicates it.

## Why not implement now

No one here has used Plannotator. Hook/port/browser collisions, remote
executor forwarding, and whether YA should wrap or merely brief the agent are
product choices. Capture the pointer; do not invent a settings surface.

Related contracts: [active content security](../../topics/active-content-security.md)
(artifact origin), [source review](../../topics/source-review-to-session.md),
[agent context injection](../../topics/agent-context-injection.md),
[pi provider sketches](../../topics/pi-provider.sketches.md) (Pi already has a
first-party Plannotator extension).

Found 2026-09-15 while taking over a stopped session that also landed
post-compact replay.
Contributing-model: grok-4.6
