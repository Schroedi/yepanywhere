# Learned speech vocabulary is global, without project-specific selection

Speech recognition selects terms from installation-wide user and assistant
counts, with a bonus for the currently loaded session's terms. It cannot favor
names from other sessions in the same project or keep another project's
specialized vocabulary from occupying the limited keyterm budget.

The owners are `packages/server/src/services/voice/VocabularyStore.ts`,
`VocabularyKeyterms.ts`, and the speech request context in
`packages/server/src/routes/speech.ts`. The existing contract and context
candidates live in [the speech topic](../topics/pluggable-speech-recognition.md#keyterm-biasing).

Deferred at the maintainer's request while implementing global
excess-over-English ranking. Project-aware selection needs a deliberate
collection and request-context contract, beyond changing the ranking:

- Associate durable session contributions with canonical YA project identity;
  preserve stable rescan, replacement, reset, and deletion semantics.
- Build on the active-session hints already supplied to batch and streaming
  requests, including a policy for drafts without a session. Define global fallback and
  default-off project biasing without depending on an unsupported server route.
- Consider project glossary terms and file names separately from learned
  occurrence counts; do not invent observed counts for these sources.
- Bound per-request queries and retained caches. Keep YA indexes in app data;
  project browsing must not write into the selected project.
- Test identical audio requests in two projects selecting different relevant
  terms, plus missing-context fallback and isolation after reset/reentry.

Found 2026-09-09 while refining learned vocabulary for Grok through YA;
explicitly requested as a follow-up gap by the maintainer.
