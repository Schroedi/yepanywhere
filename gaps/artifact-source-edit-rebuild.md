# Saving artifact source does not rebuild the rendered artifact

The [source editor](../topics/file-source-editing.md) saves original files, but
the displayed HTML remains its pre-rebuild snapshot. This applies to regular
sanitized HTML and artifact views. There is no reliable rebuild action in the
initial delivery, by explicit user acceptance. The editor labels the stale view.

Proposed artifact discovery convention:

```html
<!-- ya-artifact:v1 {"regenerate":{"hook":"report-build","registrationVersion":1}} -->
```

Resolve the id through a project-scoped, explicitly approved script registration
with argv, working directory, output paths and execution limits. A comment alone
must not authorize a command. Reuse `ya-mockup.json` regeneration metadata as
discovery where applicable, rather than maintaining two script definitions.
Run a server-owned bounded job without a provider turn; publish HTML, assets and
map together after success, retain the previous artifact on failure, and reject
late results from older inputs. See the
[round-trip sketch](sketches/source-mapped-artifact-editing.md#optional-round-trip-through-a-registered-regeneration-hook).

How Plannotator-wrapped artifacts discover the hook and refresh the correct
embedded revision remains open. Do not claim the ordinary artifact convention
solves that wrapper lifecycle.

Found 2026-09-22 while implementing source editing with accepted rebuild deferral.
Contributing-model: 6-Astra
