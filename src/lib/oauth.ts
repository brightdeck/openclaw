import { createServer } from 'node:http';

import { DECK_API_BASE_URL } from '../config.js';
import { generatePkce, generateState } from './pkce.js';

/** CIMD doc URL — derived from apiBaseUrl so self-hosted decks work. */
export function cimdUrlFor(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/mcp/.well-known/cimd/openclaw.json`;
}

export const CIMD_URL = cimdUrlFor(DECK_API_BASE_URL);

export interface OAuthResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  /** Epoch seconds — set on issue/refresh so the resolver can schedule refresh. */
  obtained_at: number;
}

interface OAuthTokenResponseBody {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export interface OAuthOptions {
  apiBaseUrl: string;
  scopes: string[];
  /** Surfaced to the gateway log so the user can manually open the URL if needed. */
  onAuthorizeUrl?: (url: string) => void;
  /** Aborts the wait for the loopback callback (e.g. the agent turn was cancelled). */
  signal?: AbortSignal;
  /** Bounds the wait for the loopback callback; defaults to 180s. */
  signInTimeoutMs?: number;
}

/** Default ceiling on how long we wait for the human to finish the sign-in. */
const DEFAULT_SIGNIN_TIMEOUT_MS = 180_000;

export interface OAuthDanceHandle {
  /** The authorize URL the user must visit to sign in. */
  authorizeUrl: string;
  /**
   * Wait for the loopback callback, validate state, and exchange the code for
   * tokens. Honours an abort signal and a timeout; always tears the loopback
   * server down when it settles. Call at most once.
   */
  awaitResult(opts?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<OAuthResult>;
  /** Tear down the loopback server without awaiting (abandon path). */
  close(): void;
}

/**
 * Start the loopback server, build the authorize URL, and emit it — the cheap
 * part of the dance. The caller then decides whether to `awaitResult` (block on
 * the human) or hand the handle to a background task. Splitting begin/await lets
 * the caller pick the abort signal AFTER it knows whether the browser actually
 * opened (a backgrounded dance must outlive the turn that started it).
 */
export async function beginOAuth(opts: {
  apiBaseUrl: string;
  scopes: string[];
  onAuthorizeUrl?: (url: string) => void;
}): Promise<OAuthDanceHandle> {
  const pkce = generatePkce();
  const state = generateState();
  const { port, codePromise, close } = await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const cimdUrl = cimdUrlFor(opts.apiBaseUrl);
  const authorizeUrl = new URL(`${opts.apiBaseUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', cimdUrl);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', pkce.challenge);
  authorizeUrl.searchParams.set('code_challenge_method', pkce.method);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('resource', `${opts.apiBaseUrl}/mcp`);
  authorizeUrl.searchParams.set('scope', opts.scopes.join(' '));

  const urlStr = authorizeUrl.toString();
  opts.onAuthorizeUrl?.(urlStr);

  return {
    authorizeUrl: urlStr,
    close,
    async awaitResult(awaitOpts) {
      try {
        // Wait for the loopback callback, but honour an abort signal and a
        // timeout so a never-completed sign-in can't hang forever. Either
        // rejection still runs the `finally close()`, tearing the server down.
        const { code, returnedState } = await waitForCallback(codePromise, {
          signal: awaitOpts?.signal,
          timeoutMs: awaitOpts?.timeoutMs ?? DEFAULT_SIGNIN_TIMEOUT_MS,
        });
        if (returnedState !== state) {
          throw new Error('[auth.state_mismatch] OAuth state mismatch');
        }

        const tokenRes = await fetch(`${opts.apiBaseUrl}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: cimdUrl,
            code_verifier: pkce.verifier,
            resource: `${opts.apiBaseUrl}/mcp`,
          }),
        });
        if (!tokenRes.ok) {
          throw new Error(`[auth.token_exchange_failed] ${tokenRes.status}`);
        }
        const body = (await tokenRes.json()) as OAuthTokenResponseBody;
        assertValidTokenBody(body);
        return { ...body, obtained_at: Math.floor(Date.now() / 1000) };
      } finally {
        close();
      }
    },
  };
}

/**
 * Blocking convenience wrapper: begin the dance and await the result in one
 * call. Preserves the original `startOAuth` contract.
 */
export async function startOAuth(opts: OAuthOptions): Promise<OAuthResult> {
  const handle = await beginOAuth({
    apiBaseUrl: opts.apiBaseUrl,
    scopes: opts.scopes,
    onAuthorizeUrl: opts.onAuthorizeUrl,
  });
  return handle.awaitResult({
    signal: opts.signal,
    timeoutMs: opts.signInTimeoutMs,
  });
}

export async function refreshAccessToken(
  apiBaseUrl: string,
  refreshToken: string
): Promise<OAuthResult> {
  const res = await fetch(`${apiBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cimdUrlFor(apiBaseUrl),
      resource: `${apiBaseUrl}/mcp`,
    }),
  });
  if (!res.ok) {
    throw new Error(`[auth.refresh_failed] ${res.status}`);
  }
  const body = (await res.json()) as OAuthTokenResponseBody;
  assertValidTokenBody(body);
  return { ...body, obtained_at: Math.floor(Date.now() / 1000) };
}

/**
 * Guard against a 2xx token response whose body is missing the fields we depend
 * on. Without this a malformed body yields a `Bearer undefined` header that the
 * backend rejects with a 401 — an opaque auth loop instead of a clear error.
 */
function assertValidTokenBody(body: OAuthTokenResponseBody): void {
  if (
    typeof body?.access_token !== 'string' ||
    body.access_token.length === 0 ||
    typeof body?.refresh_token !== 'string' ||
    body.refresh_token.length === 0 ||
    typeof body?.expires_in !== 'number'
  ) {
    throw new Error(
      '[auth.token_exchange_malformed] token response missing access_token/refresh_token/expires_in'
    );
  }
}

interface CallbackResult {
  code: string;
  returnedState: string;
}

interface WaitForCallbackOptions {
  signal?: AbortSignal;
  timeoutMs: number;
}

/**
 * Race the loopback callback against (a) an abort signal and (b) a timeout. The
 * listener and timer are always cleaned up in `finish()`, so nothing leaks once
 * the promise settles, and the caller's `finally close()` tears down the server.
 */
function waitForCallback(
  codePromise: Promise<CallbackResult>,
  opts: WaitForCallbackOptions,
): Promise<CallbackResult> {
  const { signal, timeoutMs } = opts;
  if (signal?.aborted) {
    return Promise.reject(new Error('[auth.aborted] sign-in aborted'));
  }
  return new Promise<CallbackResult>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = (): void =>
      finish(() => reject(new Error('[auth.aborted] sign-in aborted')));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              `[auth.timeout] sign-in not completed in ${Math.round(timeoutMs / 1000)}s`
            )
          )
        ),
      timeoutMs
    );
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    codePromise.then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e instanceof Error ? e : new Error(String(e))))
    );
  });
}

interface CallbackServerHandle {
  port: number;
  codePromise: Promise<CallbackResult>;
  close: () => void;
}

async function startCallbackServer(): Promise<CallbackServerHandle> {
  let resolve!: (v: CallbackResult) => void;
  let reject!: (e: Error) => void;
  const codePromise = new Promise<CallbackResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const server = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (!code || !state) {
      res.statusCode = 400;
      res.end('Missing code or state.');
      reject(new Error('[auth.bad_callback] missing code or state'));
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"></head>' +
        '<body><h2>Successfully connected to Brightdeck. You can now close this tab.</h2></body></html>'
    );
    resolve({ code, returnedState: state });
  });

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('[auth.server_setup_failed] could not bind loopback');
  }
  return {
    port: addr.port,
    codePromise,
    close: () => {
      server.close();
    },
  };
}
