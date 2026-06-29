import { DEFAULT_OAUTH_SCOPES } from "../config.js";
import { openBrowser } from "./browser-open.js";
import { refreshAccessToken, startOAuth, type OAuthResult } from "./oauth.js";
import type { TokenStore } from "./token-store.js";

const REFRESH_LEAD_SECONDS = 60;

type LogLevel = "info" | "warn" | "error";

export interface ResolveAccessTokenDeps {
  apiBaseUrl: string;
  tokenStore: TokenStore;
  /** Override for tests; defaults to console.log/warn/error. */
  log?: (level: LogLevel, message: string) => void;
  /** Forwarded into the OAuth dance so the wait can be cancelled mid-turn. */
  signal?: AbortSignal;
  /** Forwarded into the OAuth dance to bound the wait for the callback. */
  signInTimeoutMs?: number;
  /** Notified with the authorize URL so the caller can surface it on failure. */
  onAuthorizeUrl?: (url: string) => void;
}

/**
 * In-flight dance/refresh promises keyed by `apiBaseUrl`, so concurrent cold
 * tool calls in one process share a single OAuth dance (one browser open, one
 * URL) and a single refresh. Sharing the refresh matters: the backend rotates
 * refresh tokens with replay detection, so two parallel refreshes of the same
 * token would trip family revocation and log the user out everywhere. Each
 * entry clears once it settles; this is a best-effort intra-process guard and
 * is simply a no-op across one-shot processes.
 */
const inFlight = new Map<string, Promise<OAuthResult>>();

function singleFlight(
  key: string,
  fn: () => Promise<OAuthResult>,
): Promise<OAuthResult> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = fn();
  inFlight.set(key, p);
  const clear = (): void => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  };
  // Attach a rejection handler too, so the cleanup chain never surfaces as an
  // unhandled rejection; the original `p` still rejects for the real caller.
  p.then(clear, clear);
  return p;
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
      const refreshed = await singleFlight(`refresh:${deps.apiBaseUrl}`, () =>
        refreshAccessToken(deps.apiBaseUrl, stored.refresh_token),
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

  const result = await singleFlight(`dance:${deps.apiBaseUrl}`, () =>
    startOAuth({
      apiBaseUrl: deps.apiBaseUrl,
      scopes: DEFAULT_OAUTH_SCOPES,
      signal: deps.signal,
      signInTimeoutMs: deps.signInTimeoutMs,
      onAuthorizeUrl: (url) => {
        log(
          "info",
          [
            "openclaw-deck: sign in to authorize this gateway.",
            "Opening your browser… if it doesn't open, visit this URL:",
            url, // flush-left, own line — copy-safe, no box/indent to mangle.
          ].join("\n"),
        );
        // Fire-and-forget; 5s cap; headless/refused -> no-op (URL already printed).
        void openBrowser(url);
        deps.onAuthorizeUrl?.(url);
      },
    }),
  );
  await deps.tokenStore.save(result);
  return result.access_token;
}

function defaultLog(level: LogLevel, message: string): void {
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.log(message);
}
