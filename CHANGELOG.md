# Changelog

All notable changes to `@brightdeck/openclaw-deck` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
