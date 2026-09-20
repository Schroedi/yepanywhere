# A limited user's locked provider/model/effort is enforced but not shown

`topics/limited-users.md` § Delivery v1 says the New Session form shows a
locked provider, model, or effort as fixed rather than offering a choice. The
server side of that landed: `packages/server/src/routes/limited-session-launch.ts`
applies the lock and forces `sandboxLevel: "project-write"`, and a request
naming a conflicting value gets 403 with the locked value in the message.

The client side did not. `packages/client/src/components/NewSessionForm.tsx`
still offers every provider and model to a switched or logged-in limited user,
so the first sign of the lock is a refused launch. The same applies to the
forced sandbox: the toggle appears clearable and is not.

Not fixed in place because the form composes provider, model, effort, and
sandbox controls from several hooks and per-project defaults; threading the
acting principal's lock through them is its own change, and the enforcement it
would cosmetically match is already correct.

Cheap fix: read `useActingPrincipal()` in the form, and when
`principal.grants?.lock` names a field, render that field as fixed text with
the locked value and drop it from the submitted body; force the sandbox toggle
on and disabled for a limited principal.

Found 2026-09-20 while delivering limited users v1.
