# Security policy

## Supported versions

The latest minor release on the `main` branch is supported. Older versions receive
fixes only for high-severity issues that affect end users.

## Reporting a vulnerability

Please report security issues privately by emailing **security@brightdeck.ai**.
Do **not** open a public GitHub issue for security reports.

We aim to acknowledge reports within 2 business days and to publish a fix or
mitigation advisory within 30 days. We credit reporters in release notes unless
asked otherwise.

## Token handling

This plugin obtains OAuth 2.1 access tokens and refresh tokens from
`api.brightdeck.ai` (or a user-configured base URL) via PKCE through a loopback
callback. Tokens are:

- Stored as a **plaintext JSON file** with `0600` permissions (owner
  read/write only) under your OpenClaw home, at
  `<openclaw-home>/.openclaw/plugin-state/openclaw-deck/oauth.json` (or under
  `$OPENCLAW_STATE_DIR` if you set that override). This is the same posture as
  the `gh` and `aws` CLIs — and as OpenClaw's own plugin-state store — store
  credentials: plaintext on disk, protected by filesystem permissions rather
  than an at-rest cipher. The blob is scoped to the `apiBaseUrl` it was minted
  for, so it is never replayed against a different backend.
- Never logged. Network errors include status codes, not response bodies.
- Sent only to the configured `apiBaseUrl` (no cross-domain redirect followed).

To revoke stored tokens locally, delete the token file (the next tool call will
re-run the OAuth dance):

```bash
rm "$HOME/.openclaw/plugin-state/openclaw-deck/oauth.json"
```

> Note: `openclaw plugins data clear openclaw-deck` does **not** remove these
> tokens — the plugin owns this file directly rather than using the gateway's
> keyed store.
