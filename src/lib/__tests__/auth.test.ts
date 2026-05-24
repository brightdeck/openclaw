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

    const at = await resolveAccessToken({
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore,
      log,
    });
    expect(at).toBe("at-fresh");
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

    const at = await resolveAccessToken({
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore,
      log,
    });
    expect(at).toBe("at-new");
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

    await expect(flowPromise).resolves.toBe("at-fresh");
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("refresh failed"),
    );
  });
});
