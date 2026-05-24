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

The first time you invoke any tool, the plugin prints a sign-in URL like:

```
────────────────────────────────────────────────────────────────────────
openclaw-deck: sign in to authorize this gateway.
Open this URL in a browser, complete the deck sign-in, and the
tool call will resume automatically once the loopback callback
fires:

  https://api.brightdeck.ai/oauth/authorize?...

────────────────────────────────────────────────────────────────────────
```

Open that URL in any browser, sign in,
and the plugin's loopback listener (`http://127.0.0.1:NNNN/callback`)
finishes the OAuth dance and stores a refresh token. Subsequent invocations
auto-refresh — the prompt only appears on the first call per gateway and
after a server-side revocation.

> The plugin does **not** auto-open the browser. OpenClaw's plugin sandbox
> blocks `child_process` usage from third-party plugins, so you'll always
> click the URL yourself. You can copy-paste it from the gateway log or
> the channel where the tool is being called.

Headless environments (CI, server installs without an interactive browser
on the same machine that can reach `127.0.0.1:NNNN`) are not supported in
v0.1.0. The OAuth flow needs a browser that can hit the gateway's loopback.

### Self-hosted deck (advanced)

Override `apiBaseUrl` to point at your deck backend. The plugin reads
`/mcp/.well-known/cimd/openclaw.json` from the same host to bootstrap OAuth.

## Tools

| Tool                                                                           | Description                     |
| ------------------------------------------------------------------------------ | ------------------------------- |
| `deck_list_presentations`                                                      | Browse decks you can access     |
| `deck_get_presentation`                                                        | Fetch one deck's metadata       |
| `deck_get_share_link`                                                          | Get a viewer URL                |
| `deck_create_blank_presentation`                                               | Create a blank deck             |
| `deck_create_presentation`                                                     | Generate a deck from a prompt   |
| `deck_update_presentation`                                                     | Rename, change visibility, etc. |
| `deck_export_pptx_url` / `deck_export_pdf_url`                                 | Get a downloadable export URL   |
| `deck_list_permissions` / `deck_share_presentation` / `deck_revoke_permission` | Manage sharing                  |

## Troubleshooting

- **401 Unauthorized**: refresh token expired or was revoked server-side. The
  plugin automatically re-runs the OAuth dance on the next tool call.
- **Sign-in URL didn't appear**: the OAuth banner is printed via
  `console.log` to wherever your gateway routes plugin stdout. Check the
  gateway log; if nothing is there, re-run the tool and watch for the
  `openclaw-deck: sign in to authorize` block.
- **Loopback callback never fires**: the URL on the sign-in page must
  redirect to `http://127.0.0.1:NNNN/callback` — confirm the gateway is
  on the same machine (or port-forwarded) as the browser you're using.
- **Reset stored tokens**: `openclaw plugins data clear openclaw-deck`.
- **Custom backend**: set `apiBaseUrl` to your deck URL.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Security

See [SECURITY.md](SECURITY.md) for the disclosure process.
