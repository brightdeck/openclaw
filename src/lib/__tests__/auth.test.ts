import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccessToken } from "../auth.js";
import { createMemoryTokenStore } from "../token-store.js";

const realFetch = globalThis.fetch;

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

describe("resolveAccessToken", () => {
  let remoteMock: ReturnType<typeof vi.fn>;
  let restore: () => void;
  const log = vi.fn();

  beforeEach(() => {
    remoteMock = vi.fn();
    restore = installFetchMock(remoteMock);
    log.mockClear();
  });

  afterEach(() => {
    restore();
  });

  it("returns the stored access token when it is still fresh", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tokenStore = createMemoryTokenStore({
      access_token: "at-fresh",
      refresh_token: "rt-fresh",
      expires_in: 600,
      scope: "presentation:read",
      obtained_at: now,
    });

    const res = await resolveAccessToken({
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore,
      log,
    });
    expect(res).toEqual({ kind: "token", accessToken: "at-fresh" });
    expect(remoteMock).not.toHaveBeenCalled();
  });

  it("refreshes when stored token is near expiry and saves the new pair", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tokenStore = createMemoryTokenStore({
      access_token: "at-old",
      refresh_token: "rt-old",
      expires_in: 60,
      scope: "presentation:read",
      obtained_at: now - 600,
    });
    remoteMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 600,
          scope: "presentation:read",
        }),
        { status: 200 },
      ),
    );

    const res = await resolveAccessToken({
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore,
      log,
    });
    expect(res).toEqual({ kind: "token", accessToken: "at-new" });
    const stored = await tokenStore.load();
    expect(stored?.access_token).toBe("at-new");
    expect(stored?.refresh_token).toBe("rt-new");
  });

  it("falls back to the OAuth dance when refresh fails", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tokenStore = createMemoryTokenStore({
      access_token: "at-old",
      refresh_token: "rt-old",
      expires_in: 60,
      scope: "presentation:read",
      obtained_at: now - 600,
    });
    remoteMock
      .mockResolvedValueOnce(new Response("nope", { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "at-fresh",
            refresh_token: "rt-fresh",
            expires_in: 600,
            scope: "presentation:read",
          }),
          { status: 200 },
        ),
      );

    let capturedUrl = "";
    const flowPromise = resolveAccessToken({
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore,
      openBrowser: async () => true,
      log: (level, msg) => {
        const m = /(https?:\/\/\S+)/.exec(msg);
        if (m && !capturedUrl) capturedUrl = m[1]!;
        log(level, msg);
      },
    });

    await new Promise((r) => setTimeout(r, 25));
    const redirectUri = new URL(capturedUrl).searchParams.get("redirect_uri")!;
    const state = new URL(capturedUrl).searchParams.get("state")!;
    await fetch(`${redirectUri}?code=abc&state=${state}`);

    await expect(flowPromise).resolves.toEqual({
      kind: "token",
      accessToken: "at-fresh",
    });
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("refresh failed"),
    );
  });

  it("with the browser open, blocks until the callback then returns a token", async () => {
    const tokenStore = createMemoryTokenStore();
    remoteMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at-blk",
          refresh_token: "rt-blk",
          expires_in: 600,
          scope: "presentation:read",
        }),
        { status: 200 },
      ),
    );

    let capturedUrl = "";
    const flow = resolveAccessToken({
      apiBaseUrl: "https://blk.brightdeck.ai",
      tokenStore,
      openBrowser: async () => true,
      onAuthorizeUrl: (u) => {
        capturedUrl = u;
      },
    });
    let settled = false;
    void flow.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.waitFor(() => expect(capturedUrl).not.toBe(""));
    // Blocking: must not settle until the loopback callback fires.
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    const params = new URL(capturedUrl).searchParams;
    await fetch(
      `${params.get("redirect_uri")}?code=abc&state=${params.get("state")}`,
    );
    await expect(flow).resolves.toEqual({
      kind: "token",
      accessToken: "at-blk",
    });
  });

  it("with the browser refused, returns a pending-signin URL immediately", async () => {
    const tokenStore = createMemoryTokenStore();
    const res = await resolveAccessToken({
      apiBaseUrl: "https://pen.brightdeck.ai",
      tokenStore,
      openBrowser: async () => false,
      signInTimeoutMs: 100,
    });
    expect(res.kind).toBe("pending-signin");
    if (res.kind !== "pending-signin") throw new Error("unreachable");
    expect(res.url).toMatch(
      /^https:\/\/pen\.brightdeck\.ai\/oauth\/authorize\?/,
    );
    // No token exchange happened — the callback never fired.
    expect(remoteMock).not.toHaveBeenCalled();
    // Let the background dance time out and tear its loopback down.
    await new Promise((r) => setTimeout(r, 150));
  });

  it("with the browser refused, the background dance still persists the token", async () => {
    const tokenStore = createMemoryTokenStore();
    remoteMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at-bg",
          refresh_token: "rt-bg",
          expires_in: 600,
          scope: "presentation:read",
        }),
        { status: 200 },
      ),
    );

    let capturedUrl = "";
    const res = await resolveAccessToken({
      apiBaseUrl: "https://bg.brightdeck.ai",
      tokenStore,
      openBrowser: async () => false,
      signInTimeoutMs: 5000,
      onAuthorizeUrl: (u) => {
        capturedUrl = u;
      },
    });
    expect(res.kind).toBe("pending-signin");

    // Simulate the user completing sign-in in the still-listening background.
    const params = new URL(capturedUrl).searchParams;
    await fetch(
      `${params.get("redirect_uri")}?code=abc&state=${params.get("state")}`,
    );

    // The background dance persists the token → it becomes loadable.
    await vi.waitFor(async () => {
      const stored = await tokenStore.load();
      expect(stored?.access_token).toBe("at-bg");
    });
  });

  it("shares one OAuth dance across concurrent cold calls (single-flight)", async () => {
    const tokenStore = createMemoryTokenStore();
    remoteMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at-sf",
          refresh_token: "rt-sf",
          expires_in: 600,
          scope: "presentation:read",
        }),
        { status: 200 },
      ),
    );

    let capturedUrl = "";
    const capture = (_level: string, msg: string): void => {
      const m = /(https?:\/\/\S+)/.exec(msg);
      if (m && !capturedUrl) capturedUrl = m[1]!;
    };
    const a = resolveAccessToken({
      apiBaseUrl: "https://sf.brightdeck.ai",
      tokenStore,
      openBrowser: async () => true,
      log: capture,
    });
    const b = resolveAccessToken({
      apiBaseUrl: "https://sf.brightdeck.ai",
      tokenStore,
      openBrowser: async () => true,
      log: capture,
    });

    await vi.waitFor(() => expect(capturedUrl).not.toBe(""));
    const params = new URL(capturedUrl).searchParams;
    await fetch(
      `${params.get("redirect_uri")}?code=abc&state=${params.get("state")}`,
    );

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual({ kind: "token", accessToken: "at-sf" });
    expect(rb).toEqual({ kind: "token", accessToken: "at-sf" });
    // One shared dance → exactly one token exchange. A second dance would have
    // needed a second queued mock and bound a different loopback port.
    expect(remoteMock).toHaveBeenCalledOnce();
  });
});
