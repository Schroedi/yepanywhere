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

**Open questions.**

- Replay: a view must not re-run side effects on transcript reload. The
  right pane already refuses to resurrect historical apps. A view whose MCP
  server is gone should show the static tool result.
- Sandboxed sessions: Claude sandboxing removes all MCP
  ([session sandboxing](../../topics/session-sandboxing.md)). Codex has no
  equivalent lockdown today, so the bridge must not become the way around one.
- Claude Code: whether the Agent SDK exposes a tool's `_meta.ui.resourceUri`
  is unverified. Codex is the first target.
- [Interactives](../../topics/interactives.md#prior-art) proposes evaluating
  MCP Apps as YA's meta-UI message schema. Implementing this bridge would
  settle that evaluation by construction.

Found 2026-10-06 while researching MCP Apps overlap with YA project apps.
