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

## CodexOSS should consume the same services list

CodexOSS today can only mean Ollama or LM Studio:
`packages/server/src/sdk/providers/codex-oss.ts:193` picks between the two
literals, `isAuthenticated()` (`:219`) shells out to `ollama list`,
`getAvailableModels()` (`:252`) parses that same command's table, and
`buildFirstTurnArgs()` (`:661`) emits `exec --oss --local-provider <p>`.
A host serving models through vLLM directly — no Ollama, no LM Studio — is
invisible to the provider even though every model it serves is reachable.

Codex itself has no such limit. `[model_providers.<id>]` in
`~/.codex/config.toml` takes any `base_url` plus `wire_api = "chat" |
"responses"` (the shape `docs/codex-oss.md:65` already uses for Ollama), and
YA's own resume path already passes `-c model_provider="<id>"`. So targeting an
arbitrary OpenAI-compatible endpoint is a configuration question, not a Codex
capability question.

The change, once gateway services exist as a list:

- each service entry gains an opt-in "usable by CodexOSS" flag (or CodexOSS
  simply offers every enabled entry, grouped by label);
- `getAvailableModels()` reads `GET <url>/v1/models` for those entries instead
  of running `ollama list`, which also makes the readiness check a TCP/HTTP
  probe rather than a CLI invocation, and lets the same probe-then-`start`
  lifecycle above cover CodexOSS launches;
- launching writes or overrides a Codex model provider for the chosen service.
  Prefer `-c model_providers.<id>.base_url=…` / `-c model_provider=<id>`
  overrides on the command line over editing the user's `~/.codex/config.toml`
  — the Gateway precedent is that YA never mutates the CLI's own settings
  files, and the same rule should hold here;
- `--oss --local-provider` remains for a real Ollama/LM Studio entry, so the
  existing path is preserved rather than replaced.

Whether this stays inside `codex-oss` or becomes a provider-neutral
"local model service" concept is the open structural question; the settings
list is the same either way, which is the argument for building it once.

## vLLM's OpenAI extensions, and declaring context size

Verified against the installed vLLM in
`/local/graehl/vllm/.pixi/envs/default/.../vllm/entrypoints/` (source read
only; the service was not started):

- `ModelCard` (`serve/engine/protocol.py:105`) carries a top-level
  `max_model_len`. YA's gateway catalog does not look at it — `modelWindows()`
  in `packages/server/src/sdk/providers/claude-gateway.ts:193` reads only
  copilot-api's `capabilities.limits.max_context_window_tokens` /
  `max_prompt_tokens`. So a vLLM-backed gateway currently advertises *no*
  window, which means no `MAX_CONTEXT_TOKENS` and no auto-compaction window in
  the launch environment (`gatewayEnvironment`, `:96`) — exactly the harness
  input preemptive compaction depends on. Reading `max_model_len` as a
  fallback source for both windows is a small, well-isolated fix.
- `/tokenize` (`serve/tokenize/protocol.py:157`) returns `count` *and*
  `max_model_len` — the server's own tokenizer, so a prompt can be measured
  exactly rather than estimated before deciding to compact.
- This build also serves native Anthropic endpoints: `/v1/messages` and
  `/v1/messages/count_tokens` (`entrypoints/anthropic/api_router.py:51`,
  `:89`), the latter returning `input_tokens` and an optional
  `context_management` block. That makes vLLM a Claude Gateway target directly,
  with no copilot-api translation layer, and gives the harness a real
  count-tokens call for pre-turn budgeting.
- `UsageInfo.prompt_tokens_details` reports `cached_tokens` and
  `created_cache_tokens`; `completion_tokens_details.reasoning_tokens` splits
  out reasoning. Useful for accounting and for knowing when compaction would
  throw away a warm prefix cache.

### Detect vLLM, then prefer its better route

Follow the `X-Copilot-API: 1` precedent exactly: the implementation behind an
endpoint is *observed*, never configured, and re-observed when the URL changes.
vLLM identifies itself in several ways that cost nothing to check during the
catalog read or a token-info query — `owned_by: "vllm"` and a populated
`max_model_len` on every model card, `GET /version` returning
`{"version": …}` (`serve/instrumentator/basic.py:53`), and the presence of
`/tokenize` and `/v1/messages/count_tokens`. Prefer one cheap positive signal
over guessing from port or model id, and record the result per service the way
`isCopilotApi` is recorded on the catalog snapshot.

Once a service is known to be vLLM, YA should route over the best API it
serves rather than the lowest common denominator: native
Anthropic `/v1/messages` for a Claude Gateway launch (no copilot-api
translation in the path at all), `/v1/messages/count_tokens` or `/tokenize`
for exact pre-turn token budgeting, and `max_model_len` to prefill the
declared window. Keep this a preference with a fallback, not a requirement —
a vLLM build without the Anthropic entrypoint must still work over
chat-completions — and keep the existing rule that a model-specific failure
never silently switches transports.

These should be *checked and used*, not *relied upon*: the standing rule is
that harness configuration must state the supported context and output size
explicitly. Each service/model entry therefore carries a declared context
window and max output tokens as required configuration, with any
server-advertised value (copilot-api limits, vLLM `max_model_len`) used to
prefill the field and to warn when configuration and server disagree. A
service that advertises nothing is then still fully usable, and a server that
lies cannot silently move the compaction threshold.

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

- Whether a "gateway service" is a provider-neutral concept or stays
  Claude-Gateway-specific with CodexOSS reading the same list (above).
- Whether Ollama and LM Studio are worth keeping as distinct concepts at all
  once services are configurable: both are OpenAI-compatible HTTP servers, and
  the only thing YA gains from naming them is `ollama list` for enumeration,
  which `/v1/models` replaces. They may still serve competitively; the sketch
  does not assume otherwise, it just stops treating them as the only options.
- Credentials per service. Gateway reads currently send a literal
  `Bearer dummy`; a service needing a real key has nowhere to put one.
- Whether `status`/`restart` are worth wiring at all, or whether probe + start +
  stop is the whole useful surface.

Found 2026-09-16 while answering whether CodexOSS can target arbitrary local
OpenAI-compatible servers and whether Claude Gateway could union several.
