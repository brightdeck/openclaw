import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeProxyExecute } from "../tool-helper.js";
import { createMemoryTokenStore } from "../token-store.js";

const originalFetch = globalThis.fetch;

describe("makeProxyExecute", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function freshTokenStore() {
    const now = Math.floor(Date.now() / 1000);
    return createMemoryTokenStore({
      access_token: "at-fresh",
      refresh_token: "rt-fresh",
      expires_in: 600,
      scope: "presentation:read",
      obtained_at: now,
    });
  }

  it("happy path: forwards JSON-RPC envelope and returns { content, details }", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            content: [{ type: "text", text: "ok" }],
            structuredContent: { items: [] },
          },
        }),
        { status: 200 },
      ),
    );

    const execute = makeProxyExecute("deck_list_presentations", {
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore: freshTokenStore(),
    });
    const out = await execute("call-1", { skip: 0, limit: 10 });
    expect(out.content).toEqual([{ type: "text", text: "ok" }]);
    expect(out.details).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back details to null when upstream omits structuredContent", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: { content: [{ type: "text", text: "ok" }] },
        }),
        { status: 200 },
      ),
    );
    const execute = makeProxyExecute("deck_get_share_link", {
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore: freshTokenStore(),
    });
    const out = await execute("c", { presentation_id: "x" });
    expect(out.details).toBeNull();
  });

  it("on 401: clears token store, re-resolves, retries once, returns success", async () => {
    const tokenStore = freshTokenStore();
    const clearSpy = vi.spyOn(tokenStore, "clear");

    fetchMock
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      // The auth resolver sees the cleared store and starts an OAuth dance —
      // but our token still satisfies the freshness check because we re-save
      // via the resolver only when storage is empty. To keep this test
      // hermetic we re-seed the store before the second attempt by spying on
      // clear() and re-injecting tokens.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "1",
            result: {
              content: [{ type: "text", text: "retry ok" }],
              structuredContent: { ok: true },
            },
          }),
          { status: 200 },
        ),
      );

    // Re-seed the store after clear() so the second resolveAccessToken finds
    // a fresh entry without needing to launch an OAuth dance.
    clearSpy.mockImplementationOnce(async () => {
      await tokenStore.save({
        access_token: "at-after-clear",
        refresh_token: "rt-after-clear",
        expires_in: 600,
        scope: "presentation:read",
        obtained_at: Math.floor(Date.now() / 1000),
      });
    });

    const execute = makeProxyExecute("deck_list_presentations", {
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore,
    });
    const out = await execute("c", { skip: 0, limit: 10 });
    expect(out.content[0]?.text).toBe("retry ok");
    expect(out.details).toEqual({ ok: true });
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second call used the cleared-and-reseeded access token.
    const secondHeaders = fetchMock.mock.calls[1]![1].headers;
    expect(secondHeaders.Authorization).toBe("Bearer at-after-clear");
  });

  it("on persistent 401: throws DeckMCPError after a single retry", async () => {
    const tokenStore = freshTokenStore();
    const clearSpy = vi.spyOn(tokenStore, "clear");
    clearSpy.mockImplementationOnce(async () => {
      await tokenStore.save({
        access_token: "at-after-clear",
        refresh_token: "rt-after-clear",
        expires_in: 600,
        scope: "presentation:read",
        obtained_at: Math.floor(Date.now() / 1000),
      });
    });
    fetchMock
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const execute = makeProxyExecute("deck_list_presentations", {
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore,
    });
    const err = await execute("c", { skip: 0, limit: 10 }).catch((e) => e);
    expect(err.code).toBe("http.401");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates deck-formatted [code] errors without retrying", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          error: {
            code: -32602,
            message: "[validation.invalid_format] bad UUID",
          },
        }),
        { status: 200 },
      ),
    );
    const execute = makeProxyExecute("deck_get_presentation", {
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore: freshTokenStore(),
    });
    const err = await execute("c", { presentation_id: "x" }).catch((e) => e);
    expect(err.code).toBe("validation.invalid_format");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
