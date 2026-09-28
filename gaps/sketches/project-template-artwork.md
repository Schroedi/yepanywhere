# Template-provided thumbnails and icons

Requested 2026-09-28 alongside the always-visible template palette and inline
New session creation. This is a specification sketch, not an implemented format
extension. [Project templates](../../topics/project-templates.md) owns the
existing composed `.project-template/preview.svg` image contract; keep that
path compatible rather than adding a second thumbnail declaration.

## Proposed presentation

- New project always shows a radio palette, including when only one template
  is available. Title, short purpose and selection remain visible independently
  of artwork. No template dropdown on this surface.
- Use the template's preview as an optional landscape thumbnail. Use a separate
  optional small icon for compact choices and the New session selection trigger.
  Artwork describes the starter type, not the user's eventual finished app.
- Keep text-only choices the same height and equally selectable. Missing art
  must not hide a template or substitute another template's illustration.
- Template artwork is distinct from a created project's own branding or icon.
  Project preparation may generate project branding without changing the source
  template or silently turning its thumbnail into the project's identity.

## Candidate source contract

Preserve `.project-template/preview.svg`; consider a composed
`.project-template/icon.svg` for the compact mark. Both would use normal
explicit file composition and override rules. The icon filename is a proposal
until the source format authority adopts it. Authors should provide artwork
legible on both light and dark cards, with intrinsic dimensions and no embedded
text that duplicates the chooser label.

The server resolves assets from the effective source-qualified template and
validated revision, respecting source confinement and template grants. Do not
accept a caller-supplied filesystem path or remote asset URL. Listing or viewing
art never runs setup. Serve SVG as an image, never inject source markup into
the page; require self-contained assets and prevent external fetches. Local
source refresh and layered replacements must invalidate the matching art.

Before implementation, settle supported image formats, byte/dimension limits,
asset endpoint/caching and its capability gate, plus the exact icon convention
in the source library's FORMAT.md. Verify malicious SVG/external references,
source shadowing, revoked grants, missing images and light/dark mobile rendering.

The placement fixture uses bundled illustrative vector marks only. It does not
demonstrate library asset loading. Template creation remains tracked in the
[stand-up gap](../project-template-standup.md).

Contributing-model: 6-Astra.
