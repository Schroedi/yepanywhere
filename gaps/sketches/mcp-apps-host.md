# YA records MCP App views on Codex tool calls but never renders them

MCP Apps (extension `io.modelcontextprotocol/ui`, SEP-1865, stable
2026-01-26 and folded into the 2026-07-28 MCP spec's extensions framework) is
the shared successor to the ChatGPT Apps SDK and MCP-UI. Claude, ChatGPT and
VS Code render it. Codex Desktop's support is reported as intermittent: openai/codex
issues #21019 and #28900 say inline views do not render.

YA already receives everything a host needs from Codex. The installed
app-server protocol (codex-cli 0.160.1, generated types under
`packages/server/src/sdk/providers/codex-protocol/generated/v2/`) has:

- `McpAppUi {resourceUri, preferredModelDisplayMode: inline|fullscreen}` on
  `mcpToolCall` items, persisted in history so replay can render without the
  MCP catalog. YA keeps only the legacy `mcpAppResourceUri` inside the tool
  input (`packages/server/src/sdk/providers/codex.ts`, `mcp_tool_call`
  normalization), and nothing in `packages/client/src` reads it.
- `mcpServer/resource/read {server, uri, threadId, originCallId}` to fetch the
  `text/html;profile=mcp-app` view.
- `mcpServer/tool/call {server, tool, arguments, threadId}` for view-initiated
  tool calls.
- `thread/inject_items`, which YA already uses for
  `appendConversationContext`.
- `InitializeCapabilities.extensions`, documented as "MCP extension settings
  declared by the app-server client". YA sends only `experimentalApi`, so an
  MCP server that gates UI tools on host support likely never offers them
  here. That Codex forwards this map to MCP servers is inferred from the
  field doc, not verified.

**Direction.** Declare `io.modelcontextprotocol/ui` with
`mimeTypes: ["text/html;profile=mcp-app"]` at initialize, gated by a setting
that is off by default. Render a tool call's view in the
[session right pane](../../topics/session-right-pane.md). Inline mode is a
tool-row card, and fullscreen mode expands the pane. The HTML must be served
from the isolated artifact origin
([active-content security](../../topics/active-content-security.md)), never
YA's API origin. The view's `_meta.ui.csp` and `permissions` narrow that
origin's policy and never widen it. The parent page runs the `ui/*`
JSON-RPC bridge over `postMessage`, checking the frame's origin:

| View → host | Codex mapping |
|---|---|
| `tools/call` | `mcpServer/tool/call`, same server only, only tools whose `_meta.ui.visibility` includes `app`, subject to the session's approval policy |
| `resources/read` | `mcpServer/resource/read` with `originCallId` |
| `ui/update-model-context` | YA holds it latest-wins and delivers it before the next user turn, not per update ([agent context injection](../../topics/agent-context-injection.md) owns placement and cost) |
| `ui/message` | a composer draft or queued user turn; never a silent `turn/start` |
| `ui/open-link` | the existing new-window link path |
| `ui/request-display-mode` | pane expand or collapse; `pip` maps to the minimized viewer |

The host sends `tool-input`, `tool-result` and `host-context-changed`
(theme, platform, container size) from data YA already has.

**Other providers.** Most of the host is provider-neutral: the pane, the
isolated origin, the bridge, and the timing of context delivery. Only two
pieces are per-provider: finding a tool call's view, and routing the view's
own tool calls.

- **A side channel that serves any provider.** YA opens its own MCP client
  connection to the server named in the session's effective MCP config. Claude
  names tools `mcp__<server>__<tool>`, so the server is known from the tool
  name. YA lists that server's tools to find `_meta.ui.resourceUri`, reads the
  resource, and sends the view's tool calls over its own connection. The cost
  is a second connection: a stdio server is spawned twice, and a stateful
  server does not share state between the agent's connection and YA's. Prefer
  the provider's own channel where one exists, as with Codex. Use the side
  channel for stateless HTTP servers, or where the server declares that it
  tolerates a second client.
- **Claude.** Claude Code does not render MCP Apps itself; an open feature
  request asks for this in its Preview tool. Whether the Agent SDK message
  stream carries a tool descriptor's `_meta.ui` is unverified, so the side
  channel is the expected route. A held `ui/update-model-context` can ride on
  the next streamed user message.
- **ACP agents (Gemini, Grok).** YA passes `mcpServers: []` at session
  creation (`packages/server/src/sdk/providers/acp/client.ts`). Any server YA
  does pass is one YA already knows, so the side channel applies directly.
- **pi.** pi omits MCP by design ([pi provider](../../topics/pi-provider.sketches.md)).
  Views can reach a pi session only through a user-installed pi extension
  that bridges MCP. Low priority.

**Open questions.**

- Replay: a view must not re-run side effects on transcript reload. The
  right pane already refuses to resurrect historical apps. A view whose MCP
  server is gone should show the static tool result.
- Sandboxed sessions: Claude sandboxing removes all MCP
  ([session sandboxing](../../topics/session-sandboxing.md)). Codex has no
  equivalent lockdown today, so the bridge must not become the way around one.
- Order: Codex first, because its channel already exists. The side channel
  comes second, once one stateless HTTP MCP App server proves it.
- [Interactives](../../topics/interactives.md#prior-art) proposes evaluating
  MCP Apps as YA's meta-UI message schema. Implementing this bridge would
  settle that evaluation by construction.

Found 2026-10-06 while researching MCP Apps overlap with YA project apps.
