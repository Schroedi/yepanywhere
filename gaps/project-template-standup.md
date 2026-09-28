# YA cannot instantiate the composable App canvas template

The source library and local materializer exist in the default source's
[`project-templates`](https://github.com/graehl/agents/tree/master/project-templates)
directory. YA registers directories and can explicitly create
a missing directory through `packages/server/src/routes/projects.ts`, but does
not materialize templates. Its client `AddProjectForm` has no template mode.
Settings → Users has a project-root grant but no template
selection. The local Python authoring CLI is not a shipped YA integration.

The agreed format and product behavior live in
[project templates](../topics/project-templates.md#current-contract--config-driven-templates).
This gap tracks the unimplemented YA half. All existing UI prototypes were
approved on 2026-09-21; the
[implementation handoff](../docs/tactical/132-project-template-implementation.md)
compiles the delivery sequence and acceptance boundary. The prototype manifests
are draft pending the separate
agents instruction-library review; production must not silently allow drafts.

The native loader/composer now exists in
`packages/server/src/projects/template-library.ts`; its conformance tests cover
inventory validation, ordering, collisions, text overrides, source containment
and draft refusal. It composes all three current authoring templates but is not
wired to runtime creation. Settings now accepts an ordered GitHub/local source
list, pins fetched revisions, relocates retrieved repository aliases and
validates the combined inventory. Local overlays are read directly.
Materialization and production admission remain open.

## What a user sees today

User-directed placement revision (2026-09-28): New project always shows template
choices as a radio palette, even for one choice. New session may use a dropdown
trigger but must accept a new project name and offer quick inline creation
without navigating away. The mockup-first fixture is
`packages/client/mockups/project-template-placement/`; it does not close this
runtime gap. Optional template-provided thumbnails/icons have a separate
[specification sketch](sketches/project-template-artwork.md).
Contributing-model: 6-Astra.

With templates enabled, Settings → Project templates fetches and validates the
default source and lists App canvas, Web page and Storybook, each marked
**Draft — unavailable for creation**. Nothing else in YA offers a template: New
Session and Add project have no template mode, and Settings → Users has no
template grant (the "Allowed templates" control exists only in the
`packages/client/mockups/project-templates` prototype). A limited user with a
project root can only name a directory. Reported by the maintainer
2026-09-28 as missing templates and missing "allowed templates" options.

## Plan to close

The contract is complete in
[project templates](../topics/project-templates.md) and
[limited users](../topics/limited-users.md), the delivery order in
[tactical 132](../docs/tactical/132-project-template-implementation.md),
and the source side in the agents repository's `project-templates/`
program and its `gaps/portable-capability-bases.md`. What remains is
implementation. Ship it as vertical slices, each usable and
releasable on its own:

1. **Admit one template (agents side, tactical §1).** Review the App canvas
   dependency closure in `~/agents/project-templates` and promote it from
   draft to ready; Web page and Storybook follow when reviewed. Until a
   template is ready, every later slice has nothing to create from.
2. **Superuser creation end to end (§3, §5).** A server creation endpoint that
   materializes the validated revision into a fresh target, runs setup,
   initializes Git, registers the project and dispatches the one preparation
   turn with the intent, with crash-safe retry. Add a New project template
   mode behind a capability, shown to the superuser only. Closure evidence:
   create App canvas through the UI with no manual steps.
3. **Grants (§2).** Server-enforced None / Selected / Any on the limited-user
   record and in Settings → Users, defaulting to Any when the user has a
   project root (user-directed 2026-09-28), with the one-time migration of
   existing users.
4. **Limited-user creation (§2, §5).** The same flow for limited users: the
   configured root enforced server-side, the chooser limited to granted ready
   templates, setup run under the restricted identity and writable scope,
   ownership and the private-apps ceiling applied.
5. **App names and pane (§4)**, then **documentation (§6)**, as the tactical
   orders them.

Slices 1 and 2 are the shortest path to a template that actually creates a
project; the grant UI is not useful before creation exists.

## Remaining integration

- Revalidate direct local sources before creation. Bind future creation grants to
  the effective source and template identity, including shadowing across the
  ordered list. Efficient retrieval and cache retention have their own
  [gap](project-template-selective-retrieval.md).
- Connect the format consumer to materialization and scripted stand-up using the
  reference compiler's conformance cases: multiple bases, order constraints,
  exact-content/mode coalescing, root AGENTS hash deduplication, explicit
  overrides, source symlink confinement, portable destinations and fresh target.
- Connect setup argv, progress/logs, Git initialization, registration, ownership
  and app-name reservation. Define retry/crash recovery so requests cannot
  overwrite a target, create two projects, or dispatch preparation twice.
- Vendor declared skills into normal project discovery directories with their
  complete resources. Verify discovery/invocation in supported harnesses and
  beginner-facing README onboarding, including under limited-user permissions.
- Display the optional composed `.project-template/preview.svg` in the chooser
  as an image, without setup execution or inline SVG injection. Keep a
  title/description-only presentation for templates without an illustration.
- Persist wildcard app-name reservations independently of running ports and
  project lifetime. First successful claim wins; only the superuser clears
  a reservation. Settings → Apps shows owners and retained orphaned entries.
  Verify concurrent claims have exactly one winner, and stop/delete/restart or
  namespace reconfiguration cannot silently release a name. Test attempted
  release/takeover by limited users and recovery after partial setup failure.
  Store the reservation's public/private state and enforce the
  [Private apps only](../topics/limited-users.md) ceiling server-side against
  forged creation and row-update requests.
- Show the usable starter as soon as deterministic setup has built it, then
  auto-send the project-context prepare turn with intent. Keep setup, agent
  preparation and readiness distinguishable; agent failure retains the starter.
- Add the server-enforced
  [template grants](../topics/project-templates.md#limited-user-permissions) to
  existing limited principals and Settings → Users, with their defaults.
  Enforce configured project root, provider locks, sandbox, ownership,
  app-exposure ceiling, and permission rechecks at the operation.
- Implement the
  [workspace direction](../topics/limited-users.md#approved-workspace-direction-2026-09-21-not-implemented):
  Create in defaults, the two superuser-locked write scopes, and the one-time
  migration of existing users. Separate API project grants from filesystem
  write scope. Cover create/fork/resume/join and reused provider processes so
  none retains a broader principal's writable mounts. Preserve private runtime
  state, network confinement and unsupported-host refusal. Reject missing
  roots and symlink escapes.
- Implement the approved New project UI and exact older-server capability gate.
  Apply the approved supported-release capability/fallback plan recorded in
  tactical 132; existing capabilities retain their meanings.

## Closure evidence

Create App canvas through YA's actual endpoint/UI, with no manual copying or
handcrafted test-only stand-up. Verify the README-derived description, initial
Git state, usable App pane before preparation completes, intent in the one
preparation turn, commands and readiness after preparation. Test retry and
failure states, including revoked permissions and unavailable sources.

For personal-directory sandboxing, start in one owned project and prove a write
to a second owned project succeeds, while writes to a sibling user's project,
an escaping symlink and host paths fail. Prove those writes fail outside the
active project when project-only mode is locked by the superuser. In that mode,
grant new-session access to a project outside the personal directory: prove
writes inside that project succeed while writes to the user's other projects
fail. A view-only grant must not permit such a launch. Verify outside reads still
follow existing policy and no API project grant is implied by filesystem reads.

Exercise None, one, several and Any permissions through direct HTTP and relay;
try forged template/source/path inputs, path traversal and source symlink
escapes. Test a source changing between validation and creation. Materialize
then remove access to the source and prove build/test/run plus adding a server
still work. Verify project creation and instructions across supported platforms,
and desktop/phone UI including real sequential typing under concurrent updates.

Pane console forwarding/annotation, extra templates and publishing are separate
follow-ups; the current starter does not implement them. The isolated mockup is
not evidence of YA creation or authorization behavior.

Found 2026-09-21 while building the initial template library and reviewing its
YA integration. Contributing-model: 6-Astra.
