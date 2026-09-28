# Several state files are still rewritten in place

An in-place `fs.writeFile` truncates before it writes, so a shutdown or crash
between the two leaves an empty file. That is how `auth.json` was lost on
2026-09-28; the credential stores (`AuthService`, `LimitedUsersService`,
`RemoteAccessService`, `RemoteSessionService`) now save atomically and are
flushed at shutdown (topics/security.md).

These still write in place, and most then "start fresh" when unreadable:
`services/BrowserProfileService.ts`, `services/NetworkBindingService.ts`,
`recents/RecentsService.ts`, `push/PushService.ts`,
`metadata/ProjectMetadataService.ts` (project ownership and hidden projects,
which limited-user authorization reads), and
`notifications/NotificationService.ts`. Switch them to
`utils/writeFileAtomically.ts`, flush them at shutdown, and decide per file
whether an unreadable one may start fresh; `project-metadata.json` should not,
since its ownership records back limited users' grants.

Found 2026-09-28 while tracing the empty auth.json.
