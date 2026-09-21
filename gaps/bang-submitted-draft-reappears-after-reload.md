# Submitted bang draft can reappear after reload

The bang browser regression submitted `!!echo ya-bang-ok`, observed an empty
composer and a finished run, then reloaded. The old submitted draft returned.
Typing a second command appended it to that restored text. Both desktop and
phone captures exposed the concatenated command and its shell syntax error.

The bang submission branch in `packages/client/src/components/MessageInput.tsx`
calls `controls.clearInput()` after successful submission. The remaining
local/server draft persistence path needs investigation; this is not an output
rendering or shell-startup failure. The output regression explicitly clears the
restored draft before its second run so it tests the intended command.

Found 2026-09-21 while verifying bang command output and durable placement.
Contributing-model: 6-Astra
