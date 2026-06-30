import { DEFAULT_OAUTH_SCOPES } from "../config.js";
import { openBrowser } from "./browser-open.js";
import { beginOAuth, refreshAccessToken, type OAuthResult } from "./oauth.js";
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
  /** Override for tests; defaults to the real browser opener. */
  openBrowser?: (url: string) => Promise<boolean>;
}

/**
 * Discriminated result of resolving an access token. `pending-signin` means a
 * first-run dance is required but the browser could NOT be opened on the gateway
 * host — the caller must surface `url` to the user (the model relays it), and
 * the background dance keeps listening to persist the token for the re-run.
 */
export type TokenResolution =
  | { kind: "token"; accessToken: string }
  | { kind: "pending-signin"; url: string };

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
 * A first-run OAuth dance shared across concurrent cold callers in one process.
 * `result` resolves with the minted tokens (and persists them) when the loopback
 * callback fires, or rejects on abort/timeout/exchange failure.
 */
interface SharedDance {
  authorizeUrl: string;
  browserOpened: boolean;
  result: Promise<OAuthResult>;
}

/** In-flight dances keyed by `apiBaseUrl` (separate from the refresh guard). */
const danceInFlight = new Map<string, Promise<SharedDance>>();

function sharedDance(
  key: string,
  factory: () => Promise<SharedDance>,
): Promise<SharedDance> {
  const existing = danceInFlight.get(key);
  if (existing) return existing;
  const p = factory();
  danceInFlight.set(key, p);
  const clear = (): void => {
    if (danceInFlight.get(key) === p) danceInFlight.delete(key);
  };
  // Keep the entry alive until the dance FULLY settles (the loopback callback
  // fires, or it times out), so a quick re-run JOINS this dance instead of
  // spawning a second loopback server + second URL. Clear immediately if the
  // begin phase itself fails.
  p.then((sd) => {
    sd.result.then(clear, clear);
  }, clear);
  return p;
}

async function startDance(deps: ResolveAccessTokenDeps): Promise<SharedDance> {
  const log = deps.log ?? defaultLog;
  const open = deps.openBrowser ?? openBrowser;
  const handle = await beginOAuth({
    apiBaseUrl: deps.apiBaseUrl,
    scopes: DEFAULT_OAUTH_SCOPES,
    onAuthorizeUrl: (url) => {
      // Logged for the file log; in `openclaw chat` this subsystem is suppressed
      // from the terminal, which is why the URL is also surfaced via the tool
      // result (see tool-helper) on the browser-refused path.
      log(
        "info",
        [
          "openclaw-deck: sign in to authorize this gateway.",
          "Opening your browser… if it doesn't open, visit this URL:",
          url,
        ].join("\n"),
      );
      deps.onAuthorizeUrl?.(url);
    },
  });

  const browserOpened = await open(handle.authorizeUrl);
  // A backgrounded dance (browser refused) must OUTLIVE the turn that started
  // it, so it is bound only by the timeout, not the turn's abort signal. The
  // blocking dance (browser opened) honours the signal so a cancelled turn
  // tears it down.
  const signal = browserOpened ? deps.signal : undefined;
  const result = handle
    .awaitResult({ signal, timeoutMs: deps.signInTimeoutMs })
    .then(async (tok) => {
      await deps.tokenStore.save(tok);
      return tok;
    });
  // The background path has no awaiter — swallow so a later rejection can't
  // surface as an unhandled rejection. The blocking path attaches its own
  // `await`, which still observes the original rejection.
  result.catch(() => {});

  return { authorizeUrl: handle.authorizeUrl, browserOpened, result };
}

/**
 * Order of precedence: fresh stored access token > refresh > new OAuth dance.
 *
 * Returns a discriminated `TokenResolution`: a usable `token`, or — when a
 * first-run dance is needed but the browser can't be opened on the gateway host
 * — a `pending-signin` URL for the caller to surface (the background dance keeps
 * listening and persists the token for the user's re-run).
 *
 * The plugin has no paste-token or env-var path — every install goes through
 * the OAuth flow at least once.
 */
export async function resolveAccessToken(
  deps: ResolveAccessTokenDeps,
): Promise<TokenResolution> {
  const log = deps.log ?? defaultLog;
  const stored = await deps.tokenStore.load();
  if (stored) {
    const expiresAt = stored.obtained_at + stored.expires_in;
    const now = Math.floor(Date.now() / 1000);
    if (now < expiresAt - REFRESH_LEAD_SECONDS) {
      return { kind: "token", accessToken: stored.access_token };
    }
    try {
      const refreshed = await singleFlight(`refresh:${deps.apiBaseUrl}`, () =>
        refreshAccessToken(deps.apiBaseUrl, stored.refresh_token),
      );
      await deps.tokenStore.save(refreshed);
      return { kind: "token", accessToken: refreshed.access_token };
    } catch (err) {
      log(
        "warn",
        `openclaw-deck: refresh failed (${(err as Error).message}); re-authorizing`,
      );
    }
  }

  const dance = await sharedDance(`dance:${deps.apiBaseUrl}`, () =>
    startDance(deps),
  );
  if (dance.browserOpened) {
    // Browser is up — block on the human exactly as before (one-shot safe).
    const tok = await dance.result; // token already persisted inside startDance
    return { kind: "token", accessToken: tok.access_token };
  }
  // Browser refused (headless/SSH/CI/no default browser): surface the URL now;
  // the background dance keeps listening and persists the token for the re-run.
  return { kind: "pending-signin", url: dance.authorizeUrl };
}

function defaultLog(level: LogLevel, message: string): void {
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.log(message);
}
