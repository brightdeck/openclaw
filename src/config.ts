export const PLUGIN_ID = "openclaw-deck";

/** Sent as the MCP client version in the `initialize` handshake. Keep in sync
 * with `package.json` / `openclaw.plugin.json`. */
export const PLUGIN_VERSION = "0.3.0";

export const DECK_API_BASE_URL = "https://api.brightdeck.ai";

export const DEFAULT_OAUTH_SCOPES = [
  "presentation:read",
  "presentation:write",
  "agent:run",
];
