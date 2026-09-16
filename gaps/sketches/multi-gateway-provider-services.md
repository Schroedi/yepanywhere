# Claude Gateway is one URL, not a list of local model services

Gateway configuration is a single server setting — one URL, one start command,
one pair of behavior toggles — so a host that runs several OpenAI/Anthropic-
compatible model servers (copilot-api on one port, a vLLM serve script on
another, llama.cpp on a third) can expose exactly one of them to YA at a time.
Switching means editing Providers settings and losing the other catalog.

This sketch proposes a `providers` list of *gateway services*: each an
endpoint, an optional lifecycle command, and per-service behavior overrides,
with one marked default for Claude Gateway.

## What exists today

Settings are four flat keys, normalized in
`packages/server/src/services/ServerSettingsService.ts:163` and validated in
`packages/server/src/routes/settings.ts:619`:
`claudeGatewayUrl`, `claudeGatewayStartCommand`, `claudeGatewayDisableAgent`,
`claudeGatewayDisablePlanMode`. The client edits them in
`packages/client/src/pages/settings/ProvidersSettings.tsx:1015`, gated by the
`claude-gateway`, `claude-gateway-autostart`, `claude-gateway-disable-agent`,
and `claude-gateway-disable-plan-mode` capabilities.

Runtime state is static on the provider class:
`packages/server/src/sdk/providers/claude-gateway.ts:273` holds one
`gatewayUrl`, one `gatewayStartCommand`, and one `catalogSnapshot`
(`baseUrl`, `isCopilotApi`, per-model `launchMetadata`). `getAvailableModels()`
(line 407) reads `/v1/models` from exactly one endpoint and treats it as
authoritative — no merging with Claude's built-in aliases, per
`topics/claude.md` § Claude Gateway. `launchContext(model)` (line 459) already
resolves launch facts *per model*, which is the seam a union catalog needs.

Process ownership is `packages/server/src/sdk/providers/claude-gateway-launcher.ts`:
one owned child, keyed by `url + startCommand`; it probes the loopback TCP port,
runs the command only when nothing is listening, waits bounded for readiness,
and SIGTERM/SIGKILLs its process group on reconfiguration or shutdown. There is
start-on-demand but no stop-when-unused, and a command that daemonizes falls
outside YA's ownership entirely.

## Proposed shape

A list setting (working name `gatewayServices`), each entry:

- `id` — stable slug, used in persisted session metadata and model routing.
- `label` — display name ("copilot-api", "vLLM Qwen3-coder").
- `url` — as today, `http(s)` with no credentials/query/fragment. Port lives
  in the URL; a bare port is sugar for `http://127.0.0.1:<port>`.
- `serviceCommand` — optional executable, invoked as
  `<command> start|status|restart|stop` (e.g. `~/vllm/serve-model start`).
  Presence of a command is what enables lifecycle management; absence keeps
  today's "configure an already-running endpoint" behavior.
- `autoStop` — default off. When on, YA runs `<command> stop` once YA-wide live
  session count for this service reaches zero (see below).
- per-service overrides for `disableAgent` and `disablePlanMode`, each
  defaulting to the existing server-wide value.
- `enabled` — so a service can be parked without losing its configuration.

Plus `defaultGatewayServiceId`, selecting which entry Claude Gateway uses when
the union catalog is unavailable or a saved model is ambiguous.

### Per-service vs. server-wide behavior toggles

`disableAgent` and `disablePlanMode` are not OpenAI-wire concerns — they are
Claude Code harness narrowings (`permissions.deny: ["Agent"]` and
`disallowedTools` for `EnterPlanMode`/`ExitPlanMode`) applied because a
gateway-served model is often weaker at delegation and plan-mode protocol than
a first-party Claude model. That reason is *per model server*, so both belong
on the entry with the server-wide setting as the default the entry inherits.
Anything genuinely specific to one implementation stays where it is: the
`X-Copilot-API: 1` identity (`topics/claude.md`) is observed per URL from
`/v1/models` and must keep being derived, never configured — so it becomes a
per-entry observed fact, not a per-entry setting.

### Lifecycle contract

Today's rule — run the command only for loopback URLs, and only when a bounded
TCP probe finds no listener — is the safety boundary and must survive verbatim.
The whole lifecycle surface below (start, status, stop, and any escalation to
killing a port listener) is loopback-only: exact `localhost` / `localhost.`,
IPv4 `127.0.0.0/8`, or IPv6 `::1`, as classified by
`isClaudeGatewayLoopbackUrl` in
`packages/server/src/sdk/providers/claude-gateway-launcher.ts:82`. A
non-loopback entry is a remote endpoint YA merely talks to: never started,
never stopped, never signalled, and its `serviceCommand` field should be
rejected or disabled outright rather than silently ignored. On top of it:

- **start:** on catalog read or launch, probe; if nothing listens and a command
  exists, run `<command> start`, then poll for readiness as today.
- **one retry without `start`:** if the first attempt fails, retry the bare
  command once (`<command>`, no verb) before giving up. This accommodates
  service scripts that are themselves the server rather than a verb dispatcher.
  Log which form succeeded; a second surprise from the same command is a
  configuration error to surface, not a third fallback.
- **status:** `<command> status` is advisory only. The TCP probe stays the
  authority on whether a listener exists — a script that lies about status must
  not be able to suppress or force a launch.
- **stop / autoStop:** the zero-live-sessions trigger needs a YA-wide count of
  processes routed to this service. `Supervisor.getAllProcesses()` /
  `getProcessInfoList()` (`packages/server/src/supervisor/Supervisor.ts:4045`,
  `:4682`) can supply it once each live process records its resolved gateway
  service id. Debounce it — a user between turns is not a reason to unload a
  30 GB model; a short idle grace (and never stopping while any process is
  in-turn) is the minimum. Stopping via the command, rather than signalling an
  owned process group, is what finally covers daemonizing services.

  A capable service script may already defer its own shutdown until its last
  client goes idle, so YA should treat `<command> stop` as a request that may
  return promptly while the process lingers — success means the request was
  accepted, not that the port is free. Do not escalate on that basis alone.

  The simplest escalation rule covers both cases without parsing anything:
  after requesting `stop`, schedule an asynchronous re-probe N seconds later
  (tens of seconds, configurable) and kill the port's listener only if it is
  still there. A script that defers shutdown until its last client idles just
  needs N generous enough — or a repeat probe that gives up quietly rather than
  killing, when deferred shutdown is the expected behavior for that entry.

  When `stop` instead fails the way an unrecognized argument fails (nonzero
  exit with usage/"unknown option" output, or no `stop` verb at all), an
  asynchronous kill of the port's listener is authorized as fallback. That
  mechanism already exists for Apps:
  `packages/server/src/artifacts/VhostAppControl.ts` resolves the unique
  listener with `lsof -nP -a -iTCP:<port> -sTCP:LISTEN -t`, refuses a listener
  owned by another uid, walks the ancestor chain so YA or its launching parents
  can never be signalled, SIGTERMs, and polls `/proc/<pid>` start-time identity
  until the port is free (line 41 for the lookup, line 104 for the guarded
  stop). Reuse it rather than writing a second port-killer; its guards —
  same-user, unique listener, never an ancestor, observed-before-signalled —
  are exactly the ones a gateway stop needs, and `vhostAppControlAvailable`
  already states the Linux+lsof precondition for hosts where it cannot run.

### Union catalog

Feasible, and the existing per-model launch resolution is most of the work.
`catalogSnapshot` becomes a map keyed by service id; `getAvailableModels()`
fetches every enabled service concurrently (bounded, failures degrade to
"that service contributed nothing") and returns the concatenation, with each
row carrying its service id. `launchContext(model)` looks up the owning
service's `baseUrl`/`isCopilotApi`/metadata instead of the single snapshot.

The real obstacles are naming, not plumbing:

- **Collisions.** Two services can both advertise `gpt-4o` or
  `claude-sonnet-4`. Model ids must be qualified (`<serviceId>/<model>`) at
  minimum internally, with the chooser grouping by service label. An
  unqualified saved id resolves against the default service.
- **Persisted selections.** Saved model ids appear in session metadata and new-
  session defaults; qualification is a compatibility-relevant format change.
  `topics/claude.md` requires a saved-but-unadvertised model never fall back to
  an unlisted entry, which the qualified form makes easier to honor, not harder.
- **Autostart amplification.** A union catalog read must not start every
  configured service. Catalog refresh should read only already-listening
  services plus the default; a non-listening service contributes nothing until
  its model is actually selected, and *that* selection is what authorizes
  `start`. Otherwise opening New Session spins up every local model server.

If union proves too disruptive, the fallback is still a clear improvement: a
service selector in Providers settings and/or New Session, with the catalog
coming from whichever service is selected.

## Migration

Existing keys port over as a single entry (`id: "default"`, label from the
URL host:port, `url`/`serviceCommand` from the old values, overrides unset so
they inherit the server-wide toggles) and `defaultGatewayServiceId` pointing at
it. Keep reading and writing the flat keys for a deprecation window, mirroring
them to/from the default entry, so older clients and the compatibility rules in
`topics/backward-compat.md` are satisfied. A new capability (working name
`claude-gateway-services`) gates the list UI; without it the client shows
today's single-URL form.

## Not yet decided

- Whether a "gateway service" should be a provider-neutral concept rather than
  Claude-Gateway-specific. CodexOSS has the same underlying need (see
  `docs/codex-oss.md`): Codex reaches any OpenAI-compatible `base_url` through
  `model_providers.<id>` in `~/.codex/config.toml`, but
  `packages/server/src/sdk/providers/codex-oss.ts:193` hardcodes
  `ollama`/`lmstudio` and enumerates models by shelling out to `ollama list`.
  One shared services list feeding both providers is more work and more right.
- Credentials per service. Gateway reads currently send a literal
  `Bearer dummy`; a service needing a real key has nowhere to put one.
- Whether `status`/`restart` are worth wiring at all, or whether probe + start +
  stop is the whole useful surface.

Found 2026-09-16 while answering whether CodexOSS can target arbitrary local
OpenAI-compatible servers and whether Claude Gateway could union several.
