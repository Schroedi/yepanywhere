# Twelve live fixed-version capability gates exceed their 90-day lifetime

The expanded `pnpm capabilities:audit` now inventories all registry entries,
including permanent hide-only checks. On 2026-10-27 it exits nonzero for twelve
fixed-version capabilities with live client references:

- `projectQueue` (first stable v0.5.0, deadline 2026-08-30).
- `approvalAuditLog`, `git-status-enhanced`, `git-status-remote-check`,
  `git-status-pull`, `git-status-push`, `git-status-integration-options`
  (first stable v0.6.0, deadline 2026-10-04).
- `bang-commands`, `claude-additional-models`, `host-awake-control`,
  `host-identity`, `project-queue-new-session-shortcut-setting`
  (first stable v0.7.0, deadline 2026-10-23).

`pnpm --silent capabilities:audit --json` supplies the exact current file/line
references and fallback behavior. The similarly old `git-status` definition
has no live client references and is reported as `NO-CLIENT-GATE`; its reserved
identity is not a cleanup defect.

The audit implementation deliberately exposes this existing debt rather than
resetting dates or exempting cheap fallbacks. Runtime gate removal is separate
from the requested inventory/enforcement tool: document the resulting supported
baseline and update guidance in the owning feature contracts, remove obsolete
client branches and their exclusive tests, and preserve runtime-variable checks,
negative overrides and permanent IDs. The
[90-day rule](../topics/server-capabilities.md#90-day-retirement-rule) already
authorizes those removals without another permission request.

Found 2026-10-27 while broadening the user-requested capability retirement audit.
