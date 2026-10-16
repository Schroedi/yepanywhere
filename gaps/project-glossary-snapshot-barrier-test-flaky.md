# Project glossary snapshot barrier test can count an extra scan

`packages/server/test/projects/projectGlossarySubscriptionManager.test.ts`:
"shares one post-observation snapshot barrier across concurrent joiners"
failed during the full suite on 2026-10-16: it expected three calls to
`getObservedGlossaryPaths`, but observed four. The focused file immediately
passed all 20 cases (3.33 seconds). The scenario combines real filesystem
watch delivery with fake interval/timeout clocks, so an extra filesystem event
may legitimately cause another scan; investigate before relaxing the count.

No project glossary code changed in this feature. Fixing its synchronization
or assertion requires a separate review of the snapshot barrier contract;
extension watcher tests do not share that manager or fixture. Full-suite
evidence is in `.artifacts/extension-dev-all-tests.log`, focused recheck in
`.artifacts/extension-dev-glossary-focused.log`.

Found 2026-10-16 while validating watched extension development builds.
