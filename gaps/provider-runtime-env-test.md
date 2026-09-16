# Provider-runtime reattachment test disagrees with static environment forwarding

`pnpm test` fails in
`packages/server/test/sdk/providers/provider-runtime-host.test.ts`,
“reattaches the AgentSession proxy to the same worker”: the fixture expects
an unrelated environment key to be omitted, while `pickStaticAgentEnvironment`
in `packages/server/src/sdk/providers/agentctl-session-env.ts` forwards it.

The forwarding behavior predates the right-pane client work, in the static
vhost-table change. Resolve the intended boundary between configured vhost
variables and the fixed agent environment before changing the implementation
or the negative assertion. This is a server environment contract, so the
client-only pane change leaves both sides untouched.

Found 2026-09-16 while validating the session right pane.
