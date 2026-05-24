import { DEFAULT_OAUTH_SCOPES } from "../config.js";
import { refreshAccessToken, startOAuth } from "./oauth.js";
import type { TokenStore } from "./token-store.js";

const REFRESH_LEAD_SECONDS = 60;

export interface ResolveAccessTokenDeps {
  apiBaseUrl: string;
  tokenStore: TokenStore;
  /** Override for tests; defaults to console.log/warn. */
  log?: (level: "info" | "warn", message: string) => void;
}

/**
 * Order of precedence: fresh stored access token > refresh > new OAuth dance.
 *
 * The plugin has no paste-token or env-var path — every install goes through
 * the OAuth flow at least once.
 */
export async function resolveAccessToken(
  deps: ResolveAccessTokenDeps,
): Promise<string> {
  const log = deps.log ?? defaultLog;
  const stored = await deps.tokenStore.load();
  if (stored) {
    const expiresAt = stored.obtained_at + stored.expires_in;
    const now = Math.floor(Date.now() / 1000);
    if (now < expiresAt - REFRESH_LEAD_SECONDS) {
      return stored.access_token;
    }
    try {
      const refreshed = await refreshAccessToken(
        deps.apiBaseUrl,
        stored.refresh_token,
      );
      await deps.tokenStore.save(refreshed);
      return refreshed.access_token;
    } catch (err) {
      log(
        "warn",
        `openclaw-deck: refresh failed (${(err as Error).message}); re-authorizing`,
      );
    }
  }

  const result = await startOAuth({
    apiBaseUrl: deps.apiBaseUrl,
    scopes: DEFAULT_OAUTH_SCOPES,
    onAuthorizeUrl: (url) =>
      log(
        "info",
        [
          "",
          "─".repeat(72),
          "openclaw-deck: sign in to authorize this gateway.",
          "Open this URL in a browser, complete the deck sign-in, and the",
          "tool call will resume automatically once the loopback callback",
          "fires:",
          "",
          `  ${url}`,
          "",
          "─".repeat(72),
        ].join("\n"),
      ),
  });
  await deps.tokenStore.save(result);
  return result.access_token;
}

function defaultLog(level: "info" | "warn", message: string): void {
  if (level === "warn") console.warn(message);
  else console.log(message);
}
