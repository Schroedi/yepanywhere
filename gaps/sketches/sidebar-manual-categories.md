# Sidebar manual categories and per-user sections

User direction, 2026-09-28: the sidebar should offer expandable manual
categories besides **Starred** and **Last 24 Hours**. Every such section,
Starred included, gets an outline-style `-`/`+` disclosure that is clickable.
Sessions started by a limited user group under a category named for that
user. No drag-to-reorder in v1 unless it proves easy.

## Current state

`Sidebar.tsx` renders fixed Starred, Last 24 Hours, and Older sections through
`SidebarSectionHeader`: an uppercase title with a separate 20px `-`/`+`
button at the far right. Expansion persists in browser-local storage under
`UI_KEYS.sidebarSectionExpansion`, keyed by a fixed
`DEFAULT_SECTION_EXPANSION` record. Starred is a per-session server flag
(`SessionMetadataService.setStarred`). Row order follows the
[sidebar session ordering](../../topics/sidebar-session-ordering.md)
contract. A session records the principal who started it; absent means the
superuser ([limited users](../../topics/limited-users.md#usage)).

## Direction

- **Outline disclosure.** Read as: the `-`/`+` moves to lead the title like an
  outliner, and the whole header row (marker plus title) is one button with
  `aria-expanded`. The existing trailing button is a small target separated
  from its label. Alternative reading: keep the trailing position, draw the
  marker as an outlined box. Confirm before implementing.
- **Manual categories.** A user creates, renames, and deletes named
  categories and assigns a session to one from the row menu. A categorized
  session shows in its category instead of Last 24 Hours / Older; whether it
  also leaves Starred is open. Category sections sort by the same user
  chronology as the fixed sections, render in a fixed default position
  (after Starred, before Last 24 Hours is the natural guess), and each has
  its own persisted expansion state, so the fixed expansion record becomes
  keyed by section id.
- **Per-user categories.** For each limited user with loaded sessions, an
  automatic section titled with their username, placed by default directly
  under Last 24 Hours. Only the superuser sees these; a limited user's own
  sidebar is unchanged. A manual category assignment presumably wins over the
  automatic user grouping.
- **Order.** v1 uses the default order: Starred, manual categories (creation
  order), Last 24 Hours, per-user sections (by username), Older. Drag to
  reorder sections is deferred; up/down items in a section menu are a cheap
  fallback if some control is wanted.

## Open questions

- Storage: the star is server metadata so every device agrees; categories
  likely want the same (session metadata field plus a per-principal category
  list), not browser-local storage. Whether categories are per principal or
  shared with limited users is undecided.
- Single category per session vs. tags; interaction with Starred.
- Whether per-user sections include only the last 24 hours or all loaded
  sessions for that user, and how Older and pagination interact with
  categories whose rows are not all loaded (Starred already has its own
  load-more path).
- Duplicate-title grouping (`groupDuplicateSessions`) per category.
- Interaction hold: category membership changes must wait out a sidebar
  interaction like other membership changes.

No implementation is approved by this sketch.

Contributing-model: opus-5-5
