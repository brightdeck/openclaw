# @brightdeck/openclaw-deck

[![CI](https://github.com/brightdeck/openclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/brightdeck/openclaw/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@brightdeck/openclaw-deck.svg)](https://www.npmjs.com/package/@brightdeck/openclaw-deck)
[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

OpenClaw plugin for [Brightdeck](https://brightdeck.ai) — create, edit, and share
presentations from any OpenClaw-connected agent (Slack, Discord, Telegram, iMessage,
or your own).

## Install

```bash
openclaw plugins install clawhub:@brightdeck/openclaw-deck
openclaw plugins enable openclaw-deck
```

## First-run authentication

The first time you invoke any tool, the plugin opens your browser to
https://api.brightdeck.ai/oauth/authorize. After signing in via Firebase
(Google, GitHub, etc.) you're redirected back to a loopback URL and the plugin
stores a refresh token for future calls. Subsequent invocations auto-refresh.

Headless environments (CI, server installs without a browser) are not supported
in v0.1.0.

### Self-hosted deck (advanced)

Override `apiBaseUrl` to point at your deck backend. The plugin reads
`/mcp/.well-known/cimd/openclaw.json` from the same host to bootstrap OAuth.

## Tools

| Tool | Description |
|------|-------------|
| `deck_list_presentations` | Browse decks you can access |
| `deck_get_presentation` | Fetch one deck's metadata |
| `deck_get_share_link` | Get a viewer URL |
| `deck_create_blank_presentation` | Create a blank deck |
| `deck_create_presentation` | Generate a deck from a prompt |
| `deck_update_presentation` | Rename, change visibility, etc. |
| `deck_export_pptx_url` / `deck_export_pdf_url` | Get a downloadable export URL |
| `deck_list_permissions` / `deck_share_presentation` / `deck_revoke_permission` | Manage sharing |

## Troubleshooting

- **401 Unauthorized**: refresh token expired or was revoked server-side. The
  plugin automatically re-runs the OAuth dance on the next tool call.
- **OAuth callback never opens**: ensure your shell can launch the OS browser
  (the plugin uses `open` / `xdg-open` / `explorer`).
- **Reset stored tokens**: `openclaw plugins data clear openclaw-deck`.
- **Custom backend**: set `apiBaseUrl` to your deck URL.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Security

See [SECURITY.md](SECURITY.md) for the disclosure process.
