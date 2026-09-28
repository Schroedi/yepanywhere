# Sandboxed agents are not told YA's sandbox is their whole process

In archer's scooter-parkour session (2026-09-28, `project-write` with the
network firewall), the agent offered to run a preview "outside the sandbox"
with its Bash tool's `dangerouslyDisableSandbox` option, to verify it with
`ss -ltnp` "from the host's view", and wrote a `PORT=0` preview rule into the
project's `instructions/run-deploy.md` based on that model.

That option only lifts the provider's own per-command sandbox. YA launches the
whole provider process under Bubblewrap with `--unshare-all`
(`packages/server/src/session-sandbox.ts`), so every tool call, background
process and check stays in the session's namespace, and its loopback is
private ([network boundary](../topics/session-sandbox-network-boundary.md#network-enforcement)).
Its planned checks would therefore see its own listener and report a URL the
host cannot reach. The boundary holds; the agent's account of it does not,
and it tells a limited user it can step outside.

Tell a sandboxed session, in its launch context, that YA's sandbox encloses
the entire provider process, that its loopback and `/tmp` are private, that
provider-native sandbox toggles do not leave it, and how a result reaches the
user instead (YA-side serving; see the
[root artifact sketch](sketches/project-root-artifact-and-publish.md)).
Verify with a fresh sandboxed session asked to show a built app.

Found 2026-09-28 while fixing limited-user session lists and images.
