---
title: Local access and passwords
description: Require a password for direct browser access, let this device in without one, add limited users, and recover a lost password.
---

Local access is how a browser reaches the server directly, on the same machine
or across a LAN or private network. It has its own password, separate from the
[Remote Access](/docs/remote-access) relay credentials. Configure it in
**Settings → Local Access**.

## Require a password

In **Settings → Local Access**, turn on **Require Password**, enter a password
of at least 6 characters, confirm it, and choose **Apply Changes**. Browsers
then sign in at the login page and stay signed in on that device until they
sign out or the session expires.

For a headless machine, set the password from the command line before starting
the server:

```bash
yepanywhere --setup-auth "use-a-long-unique-password"
```

The command writes the password and exits; start the server normally
afterwards.

Leave **Require Password** on whenever the server listens beyond localhost,
such as with **Local Network Access** or behind your own reverse proxy.

## Let this device in without a password

**Allow Localhost Access** lets browsers on the host itself connect without
signing in, while other devices still need the password. Anything running on
the host, including agent sessions, can then reach the server without a
password. When you start a sandboxed session in that state, New Session shows
a warning under the sandbox option.

## Limited users (preview)

**Settings → Users** creates password-protected accounts for trusted family or
collaborators and grants each one selected projects. Limited users need
**Require Password** on and **Allow Localhost Access** off.

With limited users enabled, the login page asks for a username: leave it blank
to sign in as the owner. Over the relay, enter the limited username in **Log in
as** at [yepanywhere.com/remote](https://yepanywhere.com/remote); the server name
stays the same.

This preview helps prevent accidental access. It is not hardened isolation
between people who do not trust each other.

## Recover a lost password

1. Stop the server. It reads the password file only at startup, and a running
   server can overwrite a change made underneath it.
2. Set a new password:

   ```bash
   yepanywhere --setup-auth "your-new-password"
   ```

3. Start the server and sign in with the new password.

To get in once without a password, for example to change settings, start the
server with `yepanywhere --auth-disable` or the environment variable
`AUTH_DISABLED=true`. Every request is then accepted without signing in, so
restart normally when you are done.

The password is stored as a hash in `auth.json` in the data directory. See
[Security and privacy](/docs/security-and-privacy) for where that directory
lives.
