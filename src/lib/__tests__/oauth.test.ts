import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginOAuth,
  cimdUrlFor,
  CIMD_URL,
  refreshAccessToken,
  startOAuth,
} from "../oauth.js";

// Route fetches to ``apiBaseUrl/oauth/*`` through a mock; pass loopback
// (``127.0.0.1`` / ``localhost``) fetches through to the real fetch so the
// test can simulate the browser hitting our callback server.
const realFetch = globalThis.fetch;

/**
 * Poll a loopback callback URL until it refuses connections, proving the OAuth
 * server was torn down (no orphaned listener). Retries briefly because
 * ``server.close()`` is async.
 */
async function expectPortClosed(redirectUri: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(redirectUri);
    } catch {
      return; // connection refused → server closed
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`loopback ${redirectUri} still accepting connections`);
}

function installFetchMock(
  remoteMock: ReturnType<typeof vi.fn>,
): () => void {
  const originalFetch = globalThis.fetch;
  const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (/^https?:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
      return realFetch(input, init);
    }
    return remoteMock(input, init);
  });
  globalThis.fetch = wrapped as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("cimdUrlFor", () => {
  it("appends the well-known path and normalizes trailing slashes", () => {
    expect(cimdUrlFor("https://api.brightdeck.ai")).toBe(
      "https://api.brightdeck.ai/mcp/.well-known/cimd/openclaw.json",
    );
    expect(cimdUrlFor("https://api.brightdeck.ai/")).toBe(
      "https://api.brightdeck.ai/mcp/.well-known/cimd/openclaw.json",
    );
  });

  it("exports a default CIMD URL that points at the public host", () => {
    expect(CIMD_URL).toBe(
      "https://api.brightdeck.ai/mcp/.well-known/cimd/openclaw.json",
    );
  });
});

describe("refreshAccessToken", () => {
  let remoteMock: ReturnType<typeof vi.fn>;
  let restore: () => void;

  beforeEach(() => {
    remoteMock = vi.fn();
    restore = installFetchMock(remoteMock);
  });

  afterEach(() => {
    restore();
  });

  it("posts refresh_token grant and returns parsed tokens with obtained_at", async () => {
    remoteMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at-2",
          refresh_token: "rt-2",
          expires_in: 600,
          scope: "presentation:read",
        }),
        { status: 200 },
      ),
    );

    const before = Math.floor(Date.now() / 1000);
    const result = await refreshAccessToken(
      "https://api.brightdeck.ai",
      "rt-1",
    );
    const after = Math.floor(Date.now() / 1000);

    expect(result.access_token).toBe("at-2");
    expect(result.refresh_token).toBe("rt-2");
    expect(result.obtained_at).toBeGreaterThanOrEqual(before);
    expect(result.obtained_at).toBeLessThanOrEqual(after);

    expect(remoteMock).toHaveBeenCalledOnce();
    const [url, init] = remoteMock.mock.calls[0]!;
    expect(url).toBe("https://api.brightdeck.ai/oauth/token");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-1");
    expect(body.get("client_id")).toBe(
      "https://api.brightdeck.ai/mcp/.well-known/cimd/openclaw.json",
    );
    expect(body.get("resource")).toBe("https://api.brightdeck.ai/mcp");
  });

  it("throws a tagged error when the AS returns non-2xx", async () => {
    remoteMock.mockResolvedValueOnce(new Response("nope", { status: 400 }));
    await expect(
      refreshAccessToken("https://api.brightdeck.ai", "rt-1"),
    ).rejects.toThrow(/\[auth\.refresh_failed\]/);
  });
});

describe("startOAuth", () => {
  let remoteMock: ReturnType<typeof vi.fn>;
  let restore: () => void;

  beforeEach(() => {
    remoteMock = vi.fn();
    restore = installFetchMock(remoteMock);
  });

  afterEach(() => {
    restore();
  });

  it("opens a loopback server, exchanges code, and validates state", async () => {
    remoteMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 600,
          scope: "presentation:read",
        }),
        { status: 200 },
      ),
    );

    let capturedUrl = "";
    const flowPromise = startOAuth({
      apiBaseUrl: "https://api.brightdeck.ai",
      scopes: ["presentation:read"],
      onAuthorizeUrl: (u) => {
        capturedUrl = u;
      },
    });

    await new Promise((r) => setTimeout(r, 25));
    expect(capturedUrl).toMatch(
      /^https:\/\/api\.brightdeck\.ai\/oauth\/authorize\?/,
    );
    const params = new URL(capturedUrl).searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe(
      "https://api.brightdeck.ai/mcp/.well-known/cimd/openclaw.json",
    );
    expect(params.get("code_challenge_method")).toBe("S256");
    const state = params.get("state")!;
    const redirectUri = params.get("redirect_uri")!;
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const cb = await fetch(`${redirectUri}?code=abc&state=${state}`);
    expect(cb.ok).toBe(true);
    // Guards Symptom B: the loopback page must declare UTF-8 so the em-dash
    // renders as "—" instead of mojibake "â€"".
    expect(cb.headers.get("content-type")).toMatch(/charset=utf-8/i);

    const result = await flowPromise;
    expect(result.access_token).toBe("at-1");
    expect(result.refresh_token).toBe("rt-1");
    expect(remoteMock).toHaveBeenCalledOnce();
    const tokenBody = new URLSearchParams(remoteMock.mock.calls[0]![1].body);
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("code")).toBe("abc");
    expect(tokenBody.get("code_verifier")).toBeTruthy();
  });

  it("rejects on state mismatch", async () => {
    let capturedUrl = "";
    const flowPromise = startOAuth({
      apiBaseUrl: "https://api.brightdeck.ai",
      scopes: ["presentation:read"],
      onAuthorizeUrl: (u) => {
        capturedUrl = u;
      },
    });
    // Attach an early noop handler so Node doesn't briefly flag the
    // expected rejection as unhandled before ``expect`` attaches its own.
    flowPromise.catch(() => undefined);

    await new Promise((r) => setTimeout(r, 25));
    const params = new URL(capturedUrl).searchParams;
    const redirectUri = params.get("redirect_uri")!;
    await fetch(`${redirectUri}?code=abc&state=not-the-right-state`);
    await expect(flowPromise).rejects.toThrow(/\[auth\.state_mismatch\]/);
  });

  it("aborts the wait when the signal fires and tears down the loopback", async () => {
    const ac = new AbortController();
    let capturedUrl = "";
    const flowPromise = startOAuth({
      apiBaseUrl: "https://api.brightdeck.ai",
      scopes: ["presentation:read"],
      signal: ac.signal,
      signInTimeoutMs: 60_000,
      onAuthorizeUrl: (u) => {
        capturedUrl = u;
      },
    });
    flowPromise.catch(() => undefined);

    await new Promise((r) => setTimeout(r, 25));
    const redirectUri = new URL(capturedUrl).searchParams.get("redirect_uri")!;
    ac.abort();
    await expect(flowPromise).rejects.toThrow(/\[auth\.aborted\]/);
    await expectPortClosed(redirectUri);
  });

  it("times out the wait when the callback never fires and tears down the loopback", async () => {
    let capturedUrl = "";
    const flowPromise = startOAuth({
      apiBaseUrl: "https://api.brightdeck.ai",
      scopes: ["presentation:read"],
      signInTimeoutMs: 40,
      onAuthorizeUrl: (u) => {
        capturedUrl = u;
      },
    });
    flowPromise.catch(() => undefined);

    await new Promise((r) => setTimeout(r, 25));
    const redirectUri = new URL(capturedUrl).searchParams.get("redirect_uri")!;
    await expect(flowPromise).rejects.toThrow(/\[auth\.timeout\]/);
    await expectPortClosed(redirectUri);
  });
});

describe("beginOAuth", () => {
  let remoteMock: ReturnType<typeof vi.fn>;
  let restore: () => void;

  beforeEach(() => {
    remoteMock = vi.fn();
    restore = installFetchMock(remoteMock);
  });

  afterEach(() => {
    restore();
  });

  it("emits the authorize URL synchronously, before any callback is awaited", async () => {
    let emitted = "";
    const handle = await beginOAuth({
      apiBaseUrl: "https://api.brightdeck.ai",
      scopes: ["presentation:read"],
      onAuthorizeUrl: (u) => {
        emitted = u;
      },
    });
    expect(handle.authorizeUrl).toBe(emitted);
    expect(handle.authorizeUrl).toMatch(
      /^https:\/\/api\.brightdeck\.ai\/oauth\/authorize\?/,
    );
    // No token exchange happens just from begin.
    expect(remoteMock).not.toHaveBeenCalled();

    const redirectUri = new URL(handle.authorizeUrl).searchParams.get(
      "redirect_uri",
    )!;
    handle.close();
    await expectPortClosed(redirectUri);
  });

  it("awaitResult drives the dance to completion and tears the server down", async () => {
    remoteMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at-b",
          refresh_token: "rt-b",
          expires_in: 600,
          scope: "presentation:read",
        }),
        { status: 200 },
      ),
    );
    const handle = await beginOAuth({
      apiBaseUrl: "https://api.brightdeck.ai",
      scopes: ["presentation:read"],
    });
    const params = new URL(handle.authorizeUrl).searchParams;
    const redirectUri = params.get("redirect_uri")!;
    const resultPromise = handle.awaitResult({ timeoutMs: 60_000 });
    await fetch(`${redirectUri}?code=abc&state=${params.get("state")}`);
    const result = await resultPromise;
    expect(result.access_token).toBe("at-b");
    await expectPortClosed(redirectUri);
  });

  it("close() abandons the dance without awaiting and frees the port", async () => {
    const handle = await beginOAuth({
      apiBaseUrl: "https://api.brightdeck.ai",
      scopes: ["presentation:read"],
    });
    const redirectUri = new URL(handle.authorizeUrl).searchParams.get(
      "redirect_uri",
    )!;
    handle.close();
    await expectPortClosed(redirectUri);
    expect(remoteMock).not.toHaveBeenCalled();
  });
});
