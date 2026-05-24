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

- Stored at rest via OpenClaw's `provider-auth-runtime` (encrypted by the
  gateway's keystore).
- Never logged. Network errors include status codes, not response bodies.
- Sent only to the configured `apiBaseUrl` (no cross-domain redirect followed).

To revoke stored tokens locally:

```bash
openclaw plugins data clear openclaw-deck
```

The next tool call will re-run the OAuth dance.
