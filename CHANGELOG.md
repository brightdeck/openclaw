# Changelog

All notable changes to `@brightdeck/openclaw-deck` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-22

### Added
- Initial release: 11 tools for managing decks via OpenClaw
  (list/get/create/update presentations, share-link, exports, permissions).
- OAuth 2.1 + PKCE authentication via a loopback redirect to
  `https://api.brightdeck.ai`. The plugin prints the authorize URL to the
  gateway log on the first call per gateway; the user clicks it to sign in.
  Automatic browser-open is intentionally not implemented — the OpenClaw
  install scanner blocks `child_process` use from third-party plugins.
