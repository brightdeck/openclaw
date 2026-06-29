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

The first time you invoke any tool, the plugin starts an OAuth 2.1 + PKCE
sign-in. On a local machine it **opens your browser automatically** to the
authorize URL, and it also prints the URL — flush-left on its own line, so it's
easy to copy — in case the browser doesn't pop up:

```
openclaw-deck: sign in to authorize this gateway.
Opening your browser… if it doesn't open, visit this URL:
https://api.brightdeck.ai/oauth/authorize?...
```

Sign in, and the plugin's loopback listener (`http://127.0.0.1:NNNN/callback`)
finishes the OAuth dance and stores a refresh token. Subsequent invocations
auto-refresh — the prompt only appears on the first call per machine and after a
server-side revocation.

The browser is **not** auto-opened over SSH-without-`DISPLAY`, in CI, or when you
set `DECK_NO_BROWSER=1`; there the plugin just prints the copy-safe URL. If
sign-in never completes (you close the tab, or the wait times out after a few
minutes), the tool returns a short "sign-in did not complete" message instead of
silently re-prompting — finish signing in and re-run the command.

> **The loopback needs a browser on the gateway's own machine.** The callback
> lands on `127.0.0.1:NNNN` on the host running the gateway, so the browser you
> sign in with must be able to reach that host's loopback — the same machine, or
> one you've port-forwarded to. A purely remote gateway with no local or
> forwarded browser can't complete the loopback dance.

## Using the plugin

deck tools are **agent tools** — you invoke them by asking a connected agent,
not with a direct CLI command (there is no `openclaw call`). Once the plugin is
enabled and the gateway is running, ask your agent in plain language:

- In an interactive UI: run `openclaw chat`, then "list my deck presentations".
- One embedded agent turn: `openclaw agent --local -m "create a deck about Q3 results"`.
- From a connected channel (Slack, Discord, iMessage, …): message your agent normally.

To confirm the plugin loaded and see the available tools (no agent needed):

```bash
openclaw plugins inspect openclaw-deck --runtime
```

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
- **Sign-in URL didn't appear**: the sign-in block is emitted through the
  plugin's structured logger to wherever your gateway routes plugin logs. Check
  the gateway log; if nothing is there, re-run the tool and watch for the
  `openclaw-deck: sign in to authorize` block.
- **Browser didn't open**: expected over SSH-without-`DISPLAY`, in CI, or with
  `DECK_NO_BROWSER=1` — open the printed URL yourself. Otherwise confirm a
  default browser is set and the gateway host has a desktop session.
- **Loopback callback never fires**: the URL on the sign-in page must
  redirect to `http://127.0.0.1:NNNN/callback` — confirm the gateway is
  on the same machine (or port-forwarded) as the browser you're using.
- **Reset stored tokens**: delete the token file; the next tool call re-runs the
  OAuth dance. (`openclaw plugins data clear` does **not** reach it — the plugin
  owns the file directly.)

  ```bash
  rm "$HOME/.openclaw/plugin-state/openclaw-deck/oauth.json"
  ```

- **Custom backend**: set `apiBaseUrl` to your deck URL.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Security

See [SECURITY.md](SECURITY.md) for the disclosure process.
