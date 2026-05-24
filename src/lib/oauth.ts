import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { DECK_API_BASE_URL } from "../config.js";
import { generatePkce, generateState } from "./pkce.js";

/** CIMD doc URL — derived from apiBaseUrl so self-hosted decks work. */
export function cimdUrlFor(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/mcp/.well-known/cimd/openclaw.json`;
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
}

export async function startOAuth(opts: OAuthOptions): Promise<OAuthResult> {
  const pkce = generatePkce();
  const state = generateState();
  const { port, codePromise, close } = await startCallbackServer();
  try {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const cimdUrl = cimdUrlFor(opts.apiBaseUrl);
    const authorizeUrl = new URL(`${opts.apiBaseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", cimdUrl);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
    authorizeUrl.searchParams.set("code_challenge_method", pkce.method);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("resource", `${opts.apiBaseUrl}/mcp`);
    authorizeUrl.searchParams.set("scope", opts.scopes.join(" "));

    const urlStr = authorizeUrl.toString();
    opts.onAuthorizeUrl?.(urlStr);
    openBrowser(urlStr);

    const { code, returnedState } = await codePromise;
    if (returnedState !== state) {
      throw new Error("[auth.state_mismatch] OAuth state mismatch");
    }

    const tokenRes = await fetch(`${opts.apiBaseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: cimdUrl,
        code_verifier: pkce.verifier,
        resource: `${opts.apiBaseUrl}/mcp`,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(
        `[auth.token_exchange_failed] ${tokenRes.status}`,
      );
    }
    const body = (await tokenRes.json()) as OAuthTokenResponseBody;
    return { ...body, obtained_at: Math.floor(Date.now() / 1000) };
  } finally {
    close();
  }
}

export async function refreshAccessToken(
  apiBaseUrl: string,
  refreshToken: string,
): Promise<OAuthResult> {
  const res = await fetch(`${apiBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: cimdUrlFor(apiBaseUrl),
      resource: `${apiBaseUrl}/mcp`,
    }),
  });
  if (!res.ok) {
    throw new Error(`[auth.refresh_failed] ${res.status}`);
  }
  const body = (await res.json()) as OAuthTokenResponseBody;
  return { ...body, obtained_at: Math.floor(Date.now() / 1000) };
}

interface CallbackResult {
  code: string;
  returnedState: string;
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
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/callback") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    if (!code || !state) {
      res.statusCode = 400;
      res.end("Missing code or state.");
      reject(new Error("[auth.bad_callback] missing code or state"));
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end(
      "<html><body><h2>deck connected — you can close this tab.</h2></body></html>",
    );
    resolve({ code, returnedState: state });
  });

  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("[auth.server_setup_failed] could not bind loopback");
  }
  return {
    port: addr.port,
    codePromise,
    close: () => {
      server.close();
    },
  };
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // If we can't launch a browser, the gateway log still has the URL.
  }
}
