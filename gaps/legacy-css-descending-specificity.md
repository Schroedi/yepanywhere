# Legacy global CSS still orders overrides before their base rules

`cssicorn/no-descending-specificity` is enforced on every authored client
stylesheet except the four frozen legacy files (`index.css`, `renderers.css`,
`tool-rows.css`, `emulator.css`); `eslint.config.js` exempts them. Biome's
equivalent rule likewise covers only `*.module.css`. In those files 36
rules place a contextual override such as
`.composer-bottom-overflow-menu-group .mode-button` above the base
`.mode-button` rule that sets the same property.

Each one renders correctly today, because the override's higher specificity
wins regardless of order. The defect is for the reader and the next editor:
the base rule looks like the final word for a property it does not control,
and a later edit that lowers the override's specificity, for example moving
it into a module or under `:where()`, silently flips the winner. Closing the
gap lets the exemption be deleted, so the lint covers all authored CSS
uniformly.

## Plan: move the rules into modules, reorder only what must stay global

Reordering in place is the cheap-looking fix, but moving rules within
these files is the cascade-order risk `topics/css-architecture.md` warns
about, and most of these clusters have one React owner that the CSS-module
migration (`topics/css-architecture.md`) would move into a module anyway.
In a module the base/override pair becomes one owner's local rules, which
Biome and cssicorn already check. So:

1. For each cluster below with a clear React owner, run
   `pnpm css:inventory -- --owner <component>` and extract it through the
   migration runbook. The override usually becomes a variant or an
   ancestor-opt-in class (the runbook's composition rules), not a
   descendant selector.
2. For selectors that stay global by design (generated vocabulary, the
   shared `.modal` shell, file-path renderers), move the base rule above
   its override in place, checking that every rule between the old and new
   positions sets none of the moved properties on the same elements.
3. Delete the `legacyGlobalCss` override from `eslint.config.js`, run
   `pnpm css:lint`, and delete this gap in the same commit.

## Known hits (2026-10-07), grouped by likely owner

Line numbers are the later base rule; each overrides an earlier contextual
selector.

- **Composer overflow menu** (`.composer-bottom-overflow-menu-group …`,
  index.css ~4183–4227): `.mode-button` 4270, `.mode-dot` 4313,
  `.attach-button` 5197, `.thinking-toggle-button` 5464,
  `.render-mode-toolbar-button` 5722, `.conversation-view-toolbar-button`
  5723, `.heartbeat-toolbar-button` 5793, `.slash-command-button` 6031.
- **Composer keyboard panel / toolbar preview**: `.message-input-left` 5188
  and 10274, `.message-input-toolbar` 10259, `.composer-status-ages` 10299
  (overrides under `.message-input-keyboard-more-panel` and
  `.session-toolbar-preview`).
- **Session heartbeat controls**: `.session-heartbeat-item-title` 9033,
  `.session-heartbeat-item-description` 9040,
  `.session-heartbeat-presets-row` 9076,
  `.session-heartbeat-preset-button.active` 9127.
- **Settings session defaults** (`.settings-session-defaults-panel …`
  ~8161): `.new-session-provider-section` 10869, `.new-session-model-section`
  11120, `.new-session-helper-section` 11142, `.new-session-mode-section`
  11216; plus `.mode-option-dot` 11277.
- **Settings rows**: `.settings-item-info` 8077, `.settings-input` 8936,
  `.settings-input-small` 8942, `.session-toolbar-control-copy` 7966.
- **Transcript turns**: `.message` 2738, `.message-user-prompt` 2743
  (under `.btw-aside-turn`), `.user-prompt-metadata` 3006.
- **Source control**: `.git-status-empty` 14668.
- **Global by design (reorder in place)**, renderers.css: `.modal-content`
  2232 and 2278 (shared modal shell), `.file-range` 1768, `.file-path-link`
  4364, `.diff-view-container` 2059, `.model-switch-name` 2609,
  `.source-detail-icon-action` 5416.

To regenerate the list, run the rule against the four files without the
exemption, e.g. a temporary config that spreads
`cssicorn.configs.recommended` with `cssicorn/no-descending-specificity`
on.

Found 2026-10-07 while enabling eslint-cssicorn for authored client CSS.
