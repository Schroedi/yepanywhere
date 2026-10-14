# Android connection manager test intermittently sends a duplicate subscribe

`YaServerConnectionManagerTest.supportsFullWebSubscriptionChannelsWithoutSharingLocalIds`
(`packages/android/app/src/test/java/com/yepanywhere/mobile/connection/`)
failed once in a full `./gradlew lint test` run with
`expected:<[glossary, worktree]> but was:<[glossary, glossary, worktree]>`.
The class then passed five consecutive `--rerun` invocations.

The fake transport recorded the first subscription twice. That points at the
manager replaying active subscriptions while the first `subscribe` is still in
flight, for example a connection-ready restore racing the initial dispatch,
rather than at the assertion. If the race is real it would also send duplicate
subscribes to a live server after connect. Not fixed in place because the
failure appeared during unrelated notification-permission UI work and needs a
deterministic reproduction of the restore ordering first.

Found 2026-10-14 while landing the post-sign-in notification offer.
