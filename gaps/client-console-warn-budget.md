# Client console warning sites exceed the configured budget

`pnpm console:scan` reports 61 `method.warn` sites against a limit of 60 in
`scripts/console-chatter-baseline.json`. The speech settings/Qwen/GPU changes
add no client console calls; this is existing console-budget debt.

Identify the added actionable warning with the scanner's `--include-info`
output and history, then remove/gate unnecessary output or justify updating
the budget. Do not raise the limit merely to clear the check.

Found 2026-09-16 while validating speech backend installation and device UI.
