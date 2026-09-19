# Project templates

> Proposal: a library of new-project templates — YA-shipped plus a user
> git-controlled `~/ya-templates` — where a template is a prefab file tree
> (with its own `AGENTS.md`), a one-time boot prompt, and declared shape
> elements (batch, chat-turn, or canvas interactive; JS or wasm; with or
> without a loopback server) defined as shipped prompt documents that an
> agent can also apply later on request; YA materializes a template into a fresh
> git-initialized project, registers it, and opens the first session on the
> boot prompt plus an optional first-turn request, from a New Project chooser,
> a `/start-project` command, or a command field on the Projects landing page.

Topic: project-templates

Status: **proposal, nothing implemented (2026-09-19).** Facts this proposal
rests on, checked against the tree at `a34d5c7bb`:

- YA has no template concept. `POST /api/projects` (`routes/projects.ts`)
  only registers an *existing* directory; there is no mkdir and no `git init`
  for local projects.
- Apps are global Settings → Apps vhost rows `{name, port, public?}`, not
  project-linked ([[active-content-security]] § Interactive HTML artifacts).
  `name.localhost` and `name.<public root>` reverse-proxy HTTP to a loopback
  port; WebSocket upgrades answer 501; streaming responses pass through.
- Static, serverless delivery exists only through artifact grants
  (`ArtifactServer` `/a/:token/*`), with a fixed CSP.
- The data dir (`getDataDir`, `config.ts`) is opaque app data; nothing in it
  is git-controlled.
- `/` redirects to `/projects`; no command input exists outside the session
  composer ([[bang-commands]], [[emulated-slash-commands]] are composer-only).

Relation to [[interactives]]: that proposal owns *reach and runtime* for a
project-affiliated app (icon links, isolated origin, lifecycle) and its
architectural review (`interactives-architectural-review.md`) bounds what YA
may host. This topic owns *project birth*: what a template is, where the
library lives, and how a new project is created from one. A template may
produce an interactive, but templates never require YA to become an app host;
every reach path below is an existing mechanism or a clearly separate later
phase.

## Motivation

Today a new project is "point YA at a directory that already exists". The
agent then improvises layout, conventions, and any app scaffolding per
session. A template makes the first minute reproducible: the tree, the
project `AGENTS.md`, and the first prompt are curated once and reused, and
the user can save a customized project shape back into a private library.
The novice case from [[interactives]] (tap, describe the game, play it) needs
exactly this: a known starting tree the agent already knows how to extend.

## Vocabulary

- **project template** — a directory in a template library: `template.json`
  metadata, a `files/` tree copied verbatim into the new project (including
  the project's `AGENTS.md`), and `BOOT.md`, the one-time boot prompt.
- **template library** — an ordered set of template directories. Two
  sources: **shipped** (in the YA install) and **user** (`~/ya-templates`).
  The UI shows their union; a user template shadows a shipped one of the same
  name.
- **boot prompt** — `BOOT.md`, sent as the first user turn of the project's
  first session so the chosen model acts on the fresh tree immediately. Sent
  once; never re-injected.
- **first-turn request** — optional user text appended after the boot
  prompt in that same first turn.
- **shape elements** — named, composable features a project has or can
  acquire: *interaction* (`batch` stdin/stdout, `chat-turn`, `canvas`),
  *ui runtime* (`none`, `ts` — TypeScript over HTML5 canvas/SVG/DOM, the
  default — or `wasm`), *graphics* (`nanovg`, optional, over `ts` or
  `wasm`), *state* (`client` browser storage, `server` loopback process on
  the YA host). Each element is a shipped **prompt document**, not config:
  the base template's `AGENTS.md` tells the agent how to apply one later, so
  "add a server" or "add graphics" in a later turn converges on the same
  tree as choosing it at creation. Applied element text is inline-copied into
  the project for portability, never resolved at runtime from YA.
- **accelerator** — an optional script an element may ship that performs
  its mechanical part (copy files, add deps) at instantiation; a bypass of
  the prompt path for speed, never the definition of the element.
- **template bundle** — the single-pasteable text form of a template, for
  import/export.

## Template anatomy

```text
<library>/<name>/
  template.json     # name, title, description, elements, requires, version
  BOOT.md           # one-time boot prompt (markdown)
  files/            # copied into the new project root
    AGENTS.md       # project layout + the inline-copied element conventions
    README.md
    ...
```

`template.json` (minimal v1):

```jsonc
{
  "name": "canvas-ts",                    // slug; unique within a library
  "title": "2D canvas game (TypeScript)",
  "description": "HTML5 canvas drawing in TypeScript, no server",
  "elements": ["canvas", "ts", "client"], // applied at creation, in order
  "requires": ["node", "pnpm"],           // executables the boot prompt assumes
  "app": { "kind": "static", "dir": "web" } // optional: how to reach the result
}
```

### Prompt-based element layer

Elements live beside the shipped templates as prompt documents:

```text
packages/server/templates/
  elements/<element>.md      # what the element is, the layout it adds,
                             # conventions the project AGENTS.md must carry
  elements/<element>/accelerate.sh   # optional mechanical accelerator
  <template>/...             # a template = base + a list of elements
```

A template is therefore mostly a *choice of elements* plus a boot prompt. At
creation, YA copies `files/`, then either runs each listed element's
accelerator or leaves the element text in the boot prompt for the agent to
apply, and in both cases appends the element's convention section to the
project `AGENTS.md`. The base `AGENTS.md` shipped in every template says how
to apply a not-yet-present element on request ("add a server", "add
graphics"), naming the same element documents, so the lazy path and the
creation path produce the same project shape. The user library may add
elements the same way (`~/ya-templates/elements/`). The mapping from
user-facing options to resulting state is thus owned by prompt text shipped
with YA, and scripts only shortcut it; there is no template config language
beyond the element list.

`requires` is advisory: toolchain availability is an operator responsibility
([[interactives]] § App template), so YA lists missing executables in the
chooser rather than provisioning them. `app` tells the create flow which reach
path (below) applies once the agent has built something.

**Template bundle format.** One markdown document: a `template.json` fenced
block, a `BOOT.md` fenced block, then one fenced block per file headed
`### file: <relative path>`. Text files only in v1; binary assets are out of
scope (the boot prompt can fetch or generate them). Export produces this
document; import parses it or clones a git URL whose root, or a named subdir,
has the template layout. Import lands in the user library only.

## Library locations

- **Shipped:** `packages/server/templates/<name>/`, read by the server so
  hosted and relay clients see the same list and nothing enters the client
  bundle ([DEVELOPMENT.md](../DEVELOPMENT.md) § Minimalist Runtime). Shipped
  templates are ordinary committed files reviewed like source.
- **User:** `~/ya-templates`, overridable by `YEP_TEMPLATES_DIR`. Created
  lazily on the first user action that needs it (save, import, or "open
  templates dir"), as an empty git repository with an initial commit of a
  `README.md` naming the layout. Listing never creates it. This is a YA write
  outside the data dir and outside any project, so it is explicit-action
  only and reported in the UI; it is not governed by
  [[project-directory-storage]] because it is not inside a selected project,
  but the same posture applies: YA writes there only on a named user action.
- The data dir stays out of it. Templates are user-curated, git-tracked
  content; the data dir is opaque app state and is never versioned.

Listing endpoint (proposed): `GET /api/project-templates` returning the union
with `source: "shipped" | "user"` and `shadows` when a user template hides a
shipped name. Gated by a new server capability so old servers show no template
affordances ([[server-capabilities]]).

## Creating a project from a template

Inputs: template, parent directory, project name (directory basename),
optional first-turn request, provider/model for the first session.

1. Refuse an existing target directory; create `<parent>/<name>`.
2. Copy `files/` verbatim. No token substitution in v1; the boot prompt tells
   the agent to rename placeholders it finds. (Substitution is a later
   element, not a v1 config language.)
3. `git init`, stage everything, one initial commit naming the template and
   version. This is the only Git write YA performs; afterwards the project is
   an ordinary selected project and [[project-directory-storage]] applies in
   full — no `.yep/`, no excludes.
4. Register via the existing add-project path.
5. Open a new session in the project and send `BOOT.md` (+ first-turn
   request) as the first user turn. Under [[vanilla-defaults]] the composed
   turn is shown in the composer for the user to send, not auto-sent, unless
   the user chose "start immediately" in the chooser.

Failure at any step leaves nothing registered; a partially created directory
is reported with its path, not silently deleted.

**Entry points:**

- **New Project** — chooser dialog reachable from the Projects page's
  existing add-project form (a "from template" mode beside "existing
  directory"). Whether it also gets its own sidebar row is an open decision;
  the least-disturbing default is the form mode plus the landing command
  field, with a sidebar row as an Appearance option ([[vanilla-defaults]],
  [[session-ui-customization]]).
- **`/start-project [template] [first-turn-request]`** — an emulated
  composer command ([[emulated-slash-commands]]) that opens the chooser
  prefilled; with both arguments and a configured default parent directory it
  goes straight to creation. It is also the command the landing field accepts.
- **Project Templates** — library management: list with source and shadowing,
  open template dir, import from URL or pasted bundle, export bundle, "save
  current project as template" (copies the tree minus `.git` and ignored
  files, prompts for `BOOT.md`). Proposed home: Settings → Project Templates,
  with an optional sidebar row.

**Projects landing command field.** `/` keeps redirecting to `/projects`. The
Projects page gains a single-line command field at the top that accepts
`/start-project …` and the other emulated commands that make sense without a
session, plus a link to Project Templates. Default focus applies only on
pointer-fine (desktop) viewports; on touch devices auto-focus raises the
keyboard over the list, so the field is present but unfocused. The field
must keep the keystroke guarantee in [AGENTS.md](../AGENTS.md) (every
keystroke visible within 100 ms) independent of the project list loading.

## Reach: what each shape can use today

| shape | delivery today | limits |
|---|---|---|
| `batch` (stdin/stdout) | none needed; the agent runs it via tools / `!!` | — |
| `chat-turn`, `state: client` | static bundle via artifact grant | fixed CSP below |
| `canvas` `ts`/`wasm`, `state: client` | static bundle via artifact grant | fixed CSP below |
| any shape, `state: server` | vhost row → `name.localhost`, `name.<public root>` | HTTP + SSE only; no WebSocket (501, [gap](../gaps/vhost-websocket-forwarding.md)); row is global operator config |

**Wasm confirmed deliverable** on both paths. On the artifact path,
`getMimeType` maps `.wasm` to `application/wasm`, and `ARTIFACT_CSP` carries
`'unsafe-eval'`, which permits `WebAssembly.instantiate`. Two artifact-path
limits matter for templates: `worker-src 'none'` blocks Web Workers, and no
COOP/COEP headers are sent, so `SharedArrayBuffer` and wasm threads are
unavailable. Single-threaded wasm drawing to a WebGL canvas is fine; a
threaded build is not. On the vhost path the proxy forwards upstream headers
(overwriting only `Cache-Control` and `Referrer-Policy`), so a project server
can set its own COOP/COEP and MIME.

The default `canvas` runtime is `ts`: TypeScript over the browser's own
HTML5 canvas, SVG, and DOM, built with the project's bundler, no graphics
library. Agents should not be left with untyped JS tooling, so no shipped
template targets plain JS. The `graphics` element (nanovg) is opt-in on top:
nanovg-zig (zlib license) builds with `zig build -Dtarget=wasm32-freestanding`
and renders through WebGL from a small TypeScript glue file, so `ts` +
`wasm` + `graphics` is still a static bundle (`index.html`, glue, `.wasm`);
nanovg-js is the no-Zig form of the same element.

**Subdomain per project.** A vhost row named after the project, with the
operator's public root, already yields `name.graehl.org` through the
operator's tunnel. Rows are global settings, so in phase 1–2 the create flow
can only *suggest* the row. A project-declared row is phase 4 and must keep
the [[interactives]] posture: loopback-only targets, app-scoped bearer by
default, no YA API on that origin.

**Chat-turn view without the provider.** A `chat-turn` template ships a small
turn-view JS library, inline-copied into the project, that renders
session-like user/assistant turns from the project's own code (client-only
via browser storage, or from a loopback server over HTTP + SSE). It is
project code served by the project, not a YA route, and is not a YA
transcript; YA's session UI is uninvolved. Extracting that library from
YA's client is a later refactor question, not a v1 dependency.

## Phases

1. **Library and listing.** Shipped dir, `~/ya-templates` lazy git init,
   `template.json` + `BOOT.md` + `files/` layout, union listing endpoint and
   capability, read-only Project Templates page. No creation yet. ‖
2. **Create from template.** mkdir + copy + `git init` + register + boot
   session; New Project chooser mode on the Projects page; `/start-project`;
   landing command field and Templates link. ‖
3. **Element layer and shipped set.** Element prompt documents with
   optional accelerators, base `AGENTS.md` lazy-apply instructions; shipped
   templates: `batch`, `chat-turn` (client state), `canvas-ts` (default
   canvas), `canvas-wasm-zig`, `chat-turn-server` (HTTP + SSE); `graphics`
   and `server` as add-on elements. Bundle export/import and URL import;
   save-project-as-template. ‖
4. **Project-linked reach.** Project-declared vhost row / subdomain and the
   turn-view library's relation to YA's client; any managed lifecycle. This
   phase is where [[interactives]] and its architectural review govern.

## Open decisions

- Sidebar rows for New Project and Project Templates: separate toplevel rows,
  Settings only, or Appearance-gated rows.
- Default parent directory for created projects (a setting, or ask each
  time).
- Whether `BOOT.md` is sent automatically or only staged in the composer; the
  proposal defaults to staged, with an explicit "start immediately" choice.
- Bundle format details: header syntax, size limits, binary files.
- Whether the user library may also be a subdir of an existing user git repo
  rather than its own repository.
- Element conventions' exact text, which pairs compose (e.g. `canvas` +
  `chat-turn` overlay), and when an accelerator is worth shipping versus
  leaving the element prompt-only.
- Whether "add element" later is also exposed as a composer command
  (`/add-element server`) or stays a plain natural-language request the base
  `AGENTS.md` already handles.
- Whether artifact-path CSP should gain `worker-src 'self'` and COOP/COEP for
  static bundles; that is an [[active-content-security]] decision, recorded
  here only as the template-side need.

## See also

- [[interactives]], [`interactives-architectural-review.md`](interactives-architectural-review.md)
  — app reach, isolation posture, and the hosting boundary.
- [[active-content-security]] — artifact grants, vhost rows, private app
  links, and the CSP that bounds static wasm/JS bundles.
- [[session-right-pane]] — where a created project's app appears beside the
  session.
- [[project-directory-storage]] — what YA may write inside a project after
  creation.
- [[emulated-slash-commands]], [[bang-commands]] — the composer command
  mechanisms `/start-project` joins.
- [[vanilla-defaults]], [[session-ui-customization]], [[server-capabilities]]
  — gating for the new UI surfaces and endpoint.
