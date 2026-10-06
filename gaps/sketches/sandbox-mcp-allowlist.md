# Sandboxed sessions cannot use any operator-chosen MCP server

Every sandboxed Claude-family launch disables all configured MCP servers and
Claude.ai connectors
([session sandboxing § Claude MCP and connectors](../../topics/session-sandboxing.md#claude-mcp-and-connectors)).
The only planned exception is YA's own read-only view server
([agent-visible session view](agent-visible-session-view.md)). An operator who
trusts a specific server, such as a docs search or a local read-only tool, has
no way to allow it in a sandbox. A limited user's sessions are always
sandboxed, so for them the restriction is total.

Candidate shape, undecided:

- **Granularity.** An allowlist of named servers per sandbox level, with an
  optional per-limited-user override that can only narrow it. Default empty,
  so current behavior holds until an operator opts in.
- **What an entry means.** A server name, plus how far it may reach:
  in-process or stdio only, or remote URLs too. The remote-server deny rule
  stays unless an entry names a URL explicitly. Claude.ai connectors stay off
  unless a separate switch enables them.
- **Enforcement.** The allowlist feeds the same launch options that now
  empty the server map: `mcpServers`, `allowedMcpServers`, `strictMcpConfig`
  and the `mcp__<name>__*` tool rules. Codex and ACP launches get the
  equivalent configuration. A server missing from the provider's
  configuration is reported, not silently dropped.
- **UI.** Sandbox settings list the servers each provider has configured,
  with a toggle per server per level, and Settings → Users carries a
  per-user narrowing. Changes apply at the next launch, as other sandbox
  settings do.

Open questions: whether a stdio server's subprocess runs inside the sandbox
boundary or outside it with its own authority, and whether to inventory
servers from provider config files or have the operator name them.

Found 2026-10-06 while deciding that YA's view server alone passes the
sandbox MCP lockdown.
