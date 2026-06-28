import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real StreamableHTTPError class so deck-client.ts's instanceof check
// matches the 401s thrown here.
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { PLUGIN_ID } from "../../config.js";
import type { OAuthResult } from "../oauth.js";
import {
  createMemoryTokenStore,
  type TokenStore,
} from "../token-store.js";
import { makeProxyExecute } from "../tool-helper.js";

// Hoisted SDK handles shared across every per-call DeckClient. `authHeaders`
// records the bearer of each transport instantiation, in attempt order.
const h = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  terminateSession: vi.fn(),
  authHeaders: [] as Array<string | undefined>,
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(() => ({
    connect: h.connect,
    callTool: h.callTool,
    close: h.close,
  })),
}));

vi.mock(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js")
      >();
    return {
      ...actual,
      StreamableHTTPClientTransport: vi.fn((_url: URL, opts: unknown) => {
        const headers = (
          opts as { requestInit?: { headers?: Record<string, string> } }
        )?.requestInit?.headers;
        h.authHeaders.push(headers?.Authorization);
        return { terminateSession: h.terminateSession };
      }),
    };
  },
);

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
  beforeEach(() => {
    h.connect.mockReset().mockResolvedValue(undefined);
    h.callTool.mockReset();
    h.close.mockReset().mockResolvedValue(undefined);
    h.terminateSession.mockReset().mockResolvedValue(undefined);
    h.authHeaders.length = 0;
  });

  it("happy path: returns { content, details } from the SDK result", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { items: [] },
    });

    const execute = makeProxyExecute("deck_list_presentations");
    const out = await execute(
      { skip: 0, limit: 10 },
      CONFIG,
      callContext(freshTokenStore()),
    );
    expect(out.content).toEqual([{ type: "text", text: "ok" }]);
    expect(out.details).toEqual({ items: [] });
    expect(h.callTool).toHaveBeenCalledOnce();
  });

  it("falls back details to null when upstream omits structuredContent", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });
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

    // First attempt 401s on connect; the second attempt (default resolve) wins.
    h.connect.mockRejectedValueOnce(
      new StreamableHTTPError(401, "unauthorized"),
    );
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "retry ok" }],
      structuredContent: { ok: true },
    });

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
    expect(h.connect).toHaveBeenCalledTimes(2);
    // The retry attempt carried the re-resolved token.
    expect(h.authHeaders[1]).toBe("Bearer at-after-clear");
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
    h.connect
      .mockRejectedValueOnce(new StreamableHTTPError(401, "unauthorized"))
      .mockRejectedValueOnce(new StreamableHTTPError(401, "unauthorized"));

    const execute = makeProxyExecute("deck_list_presentations");
    const err = await execute(
      { skip: 0, limit: 10 },
      CONFIG,
      callContext(tokenStore),
    ).catch((e) => e);
    expect(err.code).toBe("http.401");
    expect(h.connect).toHaveBeenCalledTimes(2);
  });

  it("propagates deck-formatted [code] errors without retrying", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "[validation.invalid_format] bad UUID" }],
      isError: true,
    });
    const execute = makeProxyExecute("deck_get_presentation");
    const err = await execute(
      { presentation_id: "x" },
      CONFIG,
      callContext(freshTokenStore()),
    ).catch((e) => e);
    expect(err.code).toBe("validation.invalid_format");
    expect(h.callTool).toHaveBeenCalledOnce();
    expect(h.connect).toHaveBeenCalledOnce();
  });
});
