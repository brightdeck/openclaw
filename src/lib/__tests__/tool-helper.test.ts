import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLUGIN_ID } from "../../config.js";
import type { OAuthResult } from "../oauth.js";
import {
  createMemoryTokenStore,
  type TokenStore,
} from "../token-store.js";
import { makeProxyExecute } from "../tool-helper.js";

const originalFetch = globalThis.fetch;
const STORAGE_KEY = "oauth";

function freshTokenStore(): TokenStore {
  const now = Math.floor(Date.now() / 1000);
  return createMemoryTokenStore({
    access_token: "at-fresh",
    refresh_token: "rt-fresh",
    expires_in: 600,
    scope: "presentation:read",
    obtained_at: now,
  });
}

/**
 * Wrap an in-memory token store as a fake ``context.api`` whose keyed-store
 * delegates load/save/clear to the memory store. The plugin's
 * ``createTokenStore`` only touches ``lookup``, ``register``, and ``delete``
 * — the other methods are mocked as no-ops.
 */
function fakeApiFor(tokenStore: TokenStore) {
  return {
    id: PLUGIN_ID,
    pluginConfig: { apiBaseUrl: "https://api.brightdeck.ai" },
    runtime: {
      state: {
        openKeyedStore: vi.fn(() => ({
          lookup: vi.fn(async (key: string) =>
            key === STORAGE_KEY ? await tokenStore.load() : undefined,
          ),
          register: vi.fn(async (key: string, value: OAuthResult) => {
            if (key === STORAGE_KEY) await tokenStore.save(value);
          }),
          registerIfAbsent: vi.fn(),
          consume: vi.fn(),
          delete: vi.fn(async (key: string) => {
            if (key === STORAGE_KEY) await tokenStore.clear();
            return true;
          }),
          entries: vi.fn(),
          clear: vi.fn(),
        })),
      },
    },
    registerTool: vi.fn(),
  };
}

function callContext(tokenStore: TokenStore) {
  return {
    api: fakeApiFor(tokenStore) as never,
    toolCallId: "call-1",
  };
}

const CONFIG = { apiBaseUrl: "https://api.brightdeck.ai" } as const;

describe("makeProxyExecute", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

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

    const execute = makeProxyExecute("deck_list_presentations");
    const out = await execute(
      { skip: 0, limit: 10 },
      CONFIG,
      callContext(freshTokenStore()),
    );
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
    const execute = makeProxyExecute("deck_get_share_link");
    const out = await execute(
      { presentation_id: "x" },
      CONFIG,
      callContext(freshTokenStore()),
    );
    expect(out.details).toBeNull();
  });

  it("on 401: clears token store, re-resolves, retries once, returns success", async () => {
    const tokenStore = freshTokenStore();
    const clearSpy = vi.spyOn(tokenStore, "clear");

    fetchMock
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
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

    const execute = makeProxyExecute("deck_list_presentations");
    const out = await execute(
      { skip: 0, limit: 10 },
      CONFIG,
      callContext(tokenStore),
    );
    expect(out.content[0]?.text).toBe("retry ok");
    expect(out.details).toEqual({ ok: true });
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);

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

    const execute = makeProxyExecute("deck_list_presentations");
    const err = await execute(
      { skip: 0, limit: 10 },
      CONFIG,
      callContext(tokenStore),
    ).catch((e) => e);
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
    const execute = makeProxyExecute("deck_get_presentation");
    const err = await execute(
      { presentation_id: "x" },
      CONFIG,
      callContext(freshTokenStore()),
    ).catch((e) => e);
    expect(err.code).toBe("validation.invalid_format");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
