# The agent cannot see which app or artifact the user has open beside it

A session's agent knows only the URLs and files it printed itself. What the
user is actually looking at is invisible to it: the app, artifact or file
viewer in the [session right pane](../../topics/session-right-pane.md), a
project app opened from the sidebar, or an app another session announced.
When the user asks about "the app" or "this page", the agent reasons from its
own last printout.
[Project app entry points](project-app-entry-points.md) names the manual-switch
case. An [MCP App view](mcp-apps-host.md) would add more such state.

A crux comes before any transport: the server does not have this state. Pane
contents and the Appearance setting are browser-local, and several clients may
show the same session differently. To report anything, clients must first
publish their view, for example `{viewer kind, target (vhost app, artifact
grant, project file, MCP App view), opened-by: session|user, client id, last
focus time}`. The report then names which client it describes, by default the
one most recently focused on this session. It must not merge clients into one
fictitious view.

**Pull before push.** The read belongs in one service API, per the
[agent command runtime](../../topics/agent-command-runtime.sketches.md#decision-summary)
layering. Its first consumer is a `ya-agent` read beside the existing
`ya-agent self` ([agent self](../../topics/agent-self.md)), which reaches any
provider that has a shell. Other adapters call the same API:

- **MCP server.** This is the generic answer to "can Codex see it via MCP".
  YA would inject a per-session server, for example
  `-c mcp_servers.ya.url=...` with the launch's session credential, and
  register the equivalent server for Claude. It brings one tool surface to any
  MCP client. Its cost is a new endpoint and credential path, and Claude's
  sandbox lockdown currently removes all MCP. The runtime proposal already
  calls MCP "another adapter rather than the first provider-neutral delivery
  mechanism".
- **Codex dynamic tools.** These are experimental. `thread/start`'s
  `dynamicTools` registers client-executed tools, which Codex calls back through
  `item/tool/call`. YA already answers that callback with a stub ("No dynamic
  tool is registered for this session", `packages/server/src/sdk/providers/codex.ts`).
  It needs no config injection, network listener or MCP lockdown exception,
  but it reaches only Codex.

A push variant notifies the agent only when the user, not the session, changes
the view. The notice is appended before the next user turn and is never an
injected turn per switch. It must pass the cost and placement review in
[agent context injection](../../topics/agent-context-injection.md). An MCP App
view's `ui/update-model-context` is the same class of fact and should share
this channel.

**Out of scope here:** publishing YA's own viewers as `ui://` MCP App
resources so that ChatGPT or Codex Desktop could embed them. That direction
reverses the host and the server and has no current consumer.

Found 2026-10-06 while researching MCP Apps overlap with YA project apps.
