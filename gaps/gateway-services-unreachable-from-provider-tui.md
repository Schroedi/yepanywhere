# Configured model services are invisible to the user's own claude/codex TUI

YA reaches a configured gateway service without writing any provider config:
Claude Gateway supplies `ANTHROPIC_BASE_URL` and friends through the Claude
SDK's per-launch flag-settings layer and the child environment
(`packages/server/src/sdk/providers/claude-gateway.ts`), and CodexOSS passes
`-c model_providers.<id>.base_url=…` overrides on the command line
(`packages/server/src/sdk/providers/codex-oss.ts`). That isolation is
deliberate — see `topics/gateway-services.md` § No provider config files are
written — but it means a user who opens `claude` or `codex` in a terminal
cannot select the models YA just configured, and has to re-derive the endpoint
by hand.

The shape that would close this without giving up the isolation:

- Codex layers `$CODEX_HOME/<name>.config.toml` over the base user config when
  invoked as `codex -p <name>` (confirmed in `codex exec --help`, codex-cli
  0.154.0). YA could own one such file per codex-enabled service, so it never
  touches the file the user edits.
- Claude's routing is environment variables, so the equivalent is a small
  sourceable snippet (or a documented alias) per service rather than an edit to
  `~/.claude/settings.json`.

Both are user-visible additions, so they ship opt-in and default-off per
`topics/vanilla-defaults.md`, and any write lands atomically (temporary file
then rename) since the directory is shared with a tool the user runs.

Not fixed alongside the services work because it needs its own setting, its own
UI, and its own cleanup semantics for a service that is later removed or
renamed.

Found 2026-09-16 while implementing configurable model services.
