// Anonymous contract smoke test against a *live* deck backend (staging).
//
// Unlike the hermetic E2E (`../e2e/oauth-mcp-e2e.test.ts`, which drives a fake
// loopback backend), this exercises the real discovery + 401-challenge surface
// of a deployed deck so a release can be gated on "the backend still speaks the
// protocol the plugin expects" without a human clicking through OAuth.
//
// It is a `*.smoke.ts` file, NOT `*.test.ts`, so the default `pnpm test`
// (vitest's default include matches only `.test.`/`.spec.`) never runs it. It
// runs only via `pnpm test:smoke` (`vitest.smoke.config.ts`) — wired into
// `.github/workflows/release-smoke.yml`.
//
// Base URL comes from `DECK_SMOKE_BASE_URL` (no host literal — public-mirror
// audit). When unset, every assertion below skips. The live MCP call additionally
// requires `DECK_TEST_REFRESH_TOKEN` and stays skipped until a non-rotating
// service token exists (see the caveat on that test).
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DEFAULT_OAUTH_SCOPES } from "../../config.js";
import { DeckClient } from "../../lib/deck-client.js";
import { refreshAccessToken } from "../../lib/oauth.js";

/** Staging base URL with any trailing slash stripped; "" disables the suite. */
const BASE = (process.env.DECK_SMOKE_BASE_URL ?? "").replace(/\/+$/, "");
/** A rotating refresh token enabling the gated live MCP call; "" keeps it skipped. */
const REFRESH_TOKEN = process.env.DECK_TEST_REFRESH_TOKEN ?? "";

const CIMD_PATH = "/mcp/.well-known/cimd/openclaw.json";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// A real 43-char base64url SHA-256 digest. The authorize endpoint only checks
// the challenge is 43–128 chars before validating `redirect_uri`, and the code
// is never exchanged here, so the verifier is irrelevant — only the shape is.
const CODE_CHALLENGE = base64url(
  createHash("sha256").update("openclaw-deck-contract-smoke").digest(),
);

/** Build a fully-valid authorize URL varying only `redirect_uri`. */
function authorizeUrl(redirectUri: string): string {
  const u = new URL(`${BASE}/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", `${BASE}${CIMD_PATH}`);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("code_challenge", CODE_CHALLENGE);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", "openclaw-deck-smoke");
  u.searchParams.set("resource", `${BASE}/mcp`);
  u.searchParams.set("scope", DEFAULT_OAUTH_SCOPES.join(" "));
  return u.toString();
}

/** Unauthenticated MCP `initialize` POST (the 401-challenge trigger). */
function mcpInitPost(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The dual Accept header a real Streamable-HTTP client sends; auth is
      // checked before content negotiation, but mirror the client anyway.
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }),
    ...init,
  });
}

describe.skipIf(!BASE)("deck backend contract (anonymous)", () => {
  it("serves the self-referential CIMD document", async () => {
    const res = await fetch(`${BASE}${CIMD_PATH}`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      client_id: string;
      redirect_uris: string[];
      token_endpoint_auth_method: string;
      scope: string;
    };
    // RFC 7591bis CIMD: client_id must equal the document URL.
    expect(doc.client_id).toBe(`${BASE}${CIMD_PATH}`);
    // Port-less loopback redirects (OAuth 2.1 §2.3.1 port-agnostic match).
    expect(doc.redirect_uris).toContain("http://127.0.0.1/callback");
    expect(doc.redirect_uris).toContain("http://localhost/callback");
    expect(doc.token_endpoint_auth_method).toBe("none");
    const scopes = doc.scope.split(" ");
    for (const scope of DEFAULT_OAUTH_SCOPES) expect(scopes).toContain(scope);
  });

  it("serves RFC 8414 authorization-server metadata", async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const md = (await res.json()) as {
      authorization_endpoint: string;
      token_endpoint: string;
      code_challenge_methods_supported: string[];
      scopes_supported: string[];
    };
    expect(md.authorization_endpoint).toBe(`${BASE}/oauth/authorize`);
    expect(md.token_endpoint).toBe(`${BASE}/oauth/token`);
    expect(md.code_challenge_methods_supported).toContain("S256");
    expect(md.scopes_supported).toEqual(
      expect.arrayContaining(DEFAULT_OAUTH_SCOPES),
    );
  });

  it("serves RFC 9728 protected-resource metadata (generic + path-aware)", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const res = await fetch(`${BASE}${path}`);
      expect(res.status, path).toBe(200);
      const md = (await res.json()) as {
        resource: string;
        authorization_servers: string[];
        scopes_supported: string[];
      };
      expect(md.resource.endsWith("/mcp"), path).toBe(true);
      expect(Array.isArray(md.authorization_servers), path).toBe(true);
      expect(md.scopes_supported).toEqual(
        expect.arrayContaining(DEFAULT_OAUTH_SCOPES),
      );
    }
  });

  it("accepts a loopback /callback redirect (renders the sign-in page)", async () => {
    const res = await fetch(authorizeUrl("http://127.0.0.1:54321/callback"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    await res.text(); // drain the body
  });

  it("rejects a non-/callback loopback redirect (oauth.invalid_redirect)", async () => {
    const res = await fetch(authorizeUrl("http://127.0.0.1:54321/evil"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("oauth.invalid_redirect");
  });

  it("challenges an unauthenticated /mcp/ POST with a 401 + resource_metadata", async () => {
    const res = await mcpInitPost("/mcp/");
    await res.text(); // drain
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain("Bearer");
    expect(wwwAuth).toContain("resource_metadata=");
    expect(wwwAuth).toContain(".well-known/oauth-protected-resource");
  });

  it("serves bare /mcp directly (401), not a 307 redirect", async () => {
    // Under Node's `redirect: "manual"`, a 307 would surface as an opaque
    // redirect (status 0) — never 401. Asserting 401 therefore proves both
    // "served directly" and "did not redirect". Regression guard for the
    // bare-/mcp 307 that broke Claude.ai's connector.
    const res = await mcpInitPost("/mcp", { redirect: "manual" });
    await res.text(); // drain
    expect(res.status).not.toBe(307);
    expect(res.status).toBe(401);
  });
});

// Token-gated live call: refresh-grant -> one read-only MCP tool call.
//
// CAVEAT (why this stays skipped in CI): deck's refresh tokens ROTATE with
// replay detection + family revocation (backend `refresh_tokens.py`), so a
// static `DECK_TEST_REFRESH_TOKEN` secret is single-use — the first run
// consumes it and every later run gets the family revoked. This step is
// therefore enabled only once the backend mints a NON-rotating service refresh
// token (a separate, later backend task). Until then `DECK_TEST_REFRESH_TOKEN`
// is left unset and this describe block skips.
describe.skipIf(!BASE || !REFRESH_TOKEN)("deck backend live MCP call (token-gated)", () => {
  it("refreshes a token and lists presentations", async () => {
    const token = await refreshAccessToken(BASE, REFRESH_TOKEN);
    expect(typeof token.access_token).toBe("string");
    expect(token.access_token.length).toBeGreaterThan(0);

    const client = new DeckClient({
      baseUrl: BASE,
      accessToken: token.access_token,
    });
    const result = await client.callTool("deck_list_presentations", {});
    expect(Array.isArray(result.content)).toBe(true);
  });
});
