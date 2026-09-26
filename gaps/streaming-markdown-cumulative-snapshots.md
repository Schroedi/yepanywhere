# Streaming markdown appends cumulative assistant snapshots as deltas

`subscriptions.ts` sends `extractTextFromAssistant(message)` directly to
`Process.accumulateStreamingText`, which appends. Likewise,
`createStreamAugmenter().processStreamingMessage` feeds that entire string
to its append-only markdown coordinator. Codex's `_isStreaming` assistant
messages contain cumulative text under one stable ID, not fresh deltas.

On 2026-09-26 at `91c5aaaee`, an isolated probe through the real augmenter
fed `I’ll`, `I’ll open`, and `I’ll open a` with the same UUID. The last
pending HTML was `I’llI’ll openI’ll open a`. This can corrupt live markdown
and late-subscriber catch-up independently of message-list deduplication.

The separate [first-turn ladder](codex-first-turn-streaming-prefix-ladder.md)
reproduced without this path. No production change was made during that
diagnosis. Repair snapshot-versus-delta handling at its owning stream
boundary, including reset/completion and late-subscriber behavior; do not
strip repeated text heuristically in the renderer.

Contributing-model: gpt-6-astra

Found 2026-09-26 while diagnosing the Codex first-turn prefix ladder.
