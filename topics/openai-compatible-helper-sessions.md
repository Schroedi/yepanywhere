# OpenAI-Compatible Helper Sessions

> OpenAI-compatible helper sessions are the missing runtime layer that lets YA
> route simulated helper work, such as tailed recaps, to configured
> OpenAI-compatible endpoints instead of the parent provider.

Topic: openai-compatible-helper-sessions

## Disposition

**Removal authorized, 2026-10-27; not yet implemented.** The maintainer
selected removal of the dormant helper-target registry, hidden editor, model
discovery and selector plumbing in [core house cleaning](core-house-cleaning.md),
row 4. Preserve provider-local model selection used by retained features.
Do not build the missing runtime to justify keeping its configuration.

Upon the first concrete need for prompted UI-helper or text-processing-only
access, consider an in-house, no-tool provider managed by the provider server.
Its scope would be supplied text and prompts in, helper output out, without
tool execution. Add it only with that first consumer; it is not a prerequisite
for removing the dormant machinery or completing core house cleaning.

The earlier runtime design below is superseded as an implementation plan.
It does not commit a future provider to the old target registry, recap coupling
or selector format. This decision changes documentation only; existing code
remains pending its separate removal slice.

## Current State

YA can store helper target records as `HelperTargetConfig`, discover
`/v1/models`, and serialize a target choice as `helper-target:<id>`. That is
configuration only today.

The tailed recap path still calls the parent provider's `generateSummary()`
implementation. `Process.resolveHelperSideModel()` only resolves `Cheapest`
and `Same as main session`; any other value is returned as a raw model string.
Claude then passes that string to the Claude SDK as its `model`, and Codex only
does provider-local `Cheapest` resolution. A `helper-target:<id>` string is
therefore not a working execution target.

## Visibility Contract

Do not expose the Providers > Helper Targets editor or `helper-target:<id>`
entries in Tailed Recap Model pickers until this runtime path exists and has a
fake-endpoint regression. A visible target selector implies working execution.

Provider-local tailed recap model choices stay valid: `Cheapest`, `Same as main
session`, and concrete models from the selected provider.

## Earlier Runtime Proposal (superseded)

- Resolve `helper-target:<id>` against `ServerSettings.helperTargets`.
- Create or call an OpenAI-compatible helper session using the target
  `baseUrl`, optional model, and configured credentials/env policy.
- Keep lifecycle bounded: timeout, cancellation, and no leaked helper work after
  the parent session ends or the client goes away.
- Reuse the context and catch-up envelope from
  [side-session-config](side-session-config.md) instead of inventing a
  per-feature prompt path.
- Return only the helper feature output. Do not write helper turns into the
  parent provider transcript.
- Cover tailed recaps against a fake OpenAI-compatible endpoint before
  re-exposing helper target controls.
