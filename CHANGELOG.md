# Changelog

All notable changes to `@brightdeck/openclaw-deck` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] — 2026-06-30

### Fixed

- Bundled `openclaw.plugin.json` manifest version now matches `package.json`.
  The published 0.3.0 tarball shipped a stale `0.2.1` manifest because the
  generated (gitignored) manifest was not regenerated before publish. The
  release build now regenerates and validates the manifest on every publish
  (`prepublishOnly`), so the package and manifest versions can no longer drift.
  No functional change to tools or auth.

## [0.3.0] — 2026-06-29

### Added

- **Automatic browser open on first sign-in.** On a local machine the plugin now
  opens your default browser to the OAuth authorize URL (best-effort, 5s cap).
  This supersedes the v0.1.0 note that claimed auto-open was impossible because
  "the install scanner blocks `child_process`" — native plugins run in-process
  and are not sandboxed, so opening a browser is permitted. The browser is
  **not** opened over SSH-without-`DISPLAY`, in CI, or when `DECK_NO_BROWSER=1`
  is set; the `BROWSER` env var is intentionally never read.

### Changed

- **Copy-safe sign-in URL.** The authorize URL is now printed flush-left on its
  own line through the plugin's structured logger, instead of inside a box-drawn
  banner with a leading indent. This stops a TUI repaint or terminal soft-wrap
  from garbling the URL when you copy it.
- **Failed sign-ins are surfaced, not silently re-prompted.** When the OAuth
  dance fails (state mismatch, malformed token exchange, abort, or timeout), the
  tool now returns a clear "sign-in did not complete" message (not a hard tool
  error) so the agent relays it and you can finish signing in and re-run —
  instead of being handed a fresh URL on every call.
- `SECURITY.md` now documents the real at-rest posture (plaintext JSON +
  `0600`, like the `gh`/`aws` CLIs) instead of the previous, incorrect
  "encrypted by the gateway's keystore" claim. The local reset is now "delete
  the token file"; `openclaw plugins data clear` no longer reaches it.

### Fixed

- **OAuth token now persists across tool calls and processes.** Previously the
  token store was backed by the gateway's keyed store, which never opened on a
  ClawHub (community) install: that store is gated to trusted/bundled plugins,
  and the namespace contained a colon the SDK's validator rejects. Both threw
  before a single byte was written, so every tool call re-ran the full sign-in
  dance. Tokens are now stored in a plugin-owned, `0600` plaintext JSON file
  under the OpenClaw home (scoped per `apiBaseUrl`); a first sign-in persists
  and later calls skip the dance until a silent refresh is due. The store
  degrades to in-memory (with a warning) when no home dir resolves or the disk
  is unwritable, and never throws out of a tool call.
- **The first-run wait is now bounded and cancellable.** The wait for the
  loopback callback honours the agent turn's abort signal and an ~180s timeout,
  and always tears down the loopback server afterwards (no orphaned listener).
- **Concurrent tool calls share one sign-in / refresh.** An in-process
  single-flight guard keyed by backend URL prevents stacked OAuth dances and,
  more importantly, parallel refreshes of the same (rotating) refresh token —
  which would otherwise trip the backend's replay detection and revoke the whole
  token family.
- **Malformed token responses fail fast** with `auth.token_exchange_malformed`
  instead of producing a `Bearer undefined` header and an opaque 401 loop.

## [0.2.1] — 2026-06-27

### Fixed

- Plugin install from ClawHub failed (`could not create a plugin-local
node_modules/openclaw link`). The runtime libraries are now **bundled** into
  `dist/index.js`, so the published package declares **no npm `dependencies`**.
  This stops OpenClaw's staging `npm install` from materializing a real
  `node_modules/openclaw` directory that blocked the `openclaw`
  peer-dependency symlink. No functional change to tools or auth — the
  SDK-based MCP client behaviour is identical.
- The bundle no longer pulls in `ajv` (a transitive MCP-SDK dependency whose
  JSON-schema compiler uses `new Function`), which OpenClaw's plugin security
  scanner blocked as dynamic code execution. The SDK client is given a
  pass-through `jsonSchemaValidator` (we map tool results ourselves and don't
  rely on `outputSchema` validation), and the bundler stubs `ajv` out entirely.

## [0.2.0] — 2026-06-27

### Fixed

- Loopback OAuth success page now declares `text/html; charset=utf-8` (plus a
  doctype and `<meta charset>`), so "deck connected — you can close this tab."
  renders the em-dash correctly instead of mojibake (`â€"`).
- Tool calls now use the official `@modelcontextprotocol/sdk` Streamable-HTTP
  client instead of a hand-rolled JSON-only POST. This fixes two connect
  failures against the deck backend:
  - **HTTP 406** — the SDK sends the required dual
    `Accept: application/json, text/event-stream` header and parses SSE replies.
  - **Missing session handshake** — the SDK performs the MCP
    `initialize` → `notifications/initialized` exchange and carries the
    `mcp-session-id` that deck's stateful server requires before `tools/call`.

### Changed

- Added `@modelcontextprotocol/sdk` (with its `zod` peer dependency).
  The plugin keeps its own OAuth 2.1 + PKCE dance; the SDK only carries the
  resulting bearer token. The HTTP-401 re-auth-once behaviour is unchanged.

## [0.1.0] — 2026-05-22

### Added

- Initial release: 11 tools for managing decks via OpenClaw
  (list/get/create/update presentations, share-link, exports, permissions).
- OAuth 2.1 + PKCE authentication via a loopback redirect to
  `https://api.brightdeck.ai`. The plugin prints the authorize URL to the
  gateway log on the first call per gateway; the user clicks it to sign in.
  Automatic browser-open is intentionally not implemented — the OpenClaw
  install scanner blocks `child_process` use from third-party plugins.
