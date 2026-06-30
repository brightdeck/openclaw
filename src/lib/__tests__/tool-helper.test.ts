import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real StreamableHTTPError class so deck-client.ts's instanceof check
// matches the 401s thrown here.
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { PLUGIN_ID } from "../../config.js";
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

// The token store is injected via the makeProxyExecute test seam, so the fake
// ``context.api`` only needs the logger surface the store factory closes over.
const fakeApi = {
  id: PLUGIN_ID,
  pluginConfig: { apiBaseUrl: "https://api.brightdeck.ai" },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as never;

function callContext() {
  return { api: fakeApi, toolCallId: "call-1" };
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

    const tokenStore = freshTokenStore();
    const execute = makeProxyExecute("deck_list_presentations", {
      createTokenStore: () => tokenStore,
    });
    const out = await execute({ skip: 0, limit: 10 }, CONFIG, callContext());
    expect(out.content).toEqual([{ type: "text", text: "ok" }]);
    expect(out.details).toEqual({ items: [] });
    expect(h.callTool).toHaveBeenCalledOnce();
  });

  it("falls back details to null when upstream omits structuredContent", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });
    const tokenStore = freshTokenStore();
    const execute = makeProxyExecute("deck_get_share_link", {
      createTokenStore: () => tokenStore,
    });
    const out = await execute({ presentation_id: "x" }, CONFIG, callContext());
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

    const execute = makeProxyExecute("deck_list_presentations", {
      createTokenStore: () => tokenStore,
    });
    const out = await execute({ skip: 0, limit: 10 }, CONFIG, callContext());
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

    const execute = makeProxyExecute("deck_list_presentations", {
      createTokenStore: () => tokenStore,
    });
    const err = await execute(
      { skip: 0, limit: 10 },
      CONFIG,
      callContext(),
    ).catch((e) => e);
    expect(err.code).toBe("http.401");
    expect(h.connect).toHaveBeenCalledTimes(2);
  });

  it("browser refused: returns a pending-signin result carrying the URL", async () => {
    // Empty store forces the dance; the browser can't open, so the proxy returns
    // immediately with the URL for the model to relay (background dance persists).
    const tokenStore = createMemoryTokenStore();
    const execute = makeProxyExecute("deck_list_presentations", {
      createTokenStore: () => tokenStore,
      openBrowser: async () => false,
      signInTimeoutMs: 100,
    });
    const out = await execute(
      { skip: 0, limit: 10 },
      { apiBaseUrl: "https://pen.brightdeck.ai" },
      callContext(),
    );

    expect(out.details).toMatchObject({ auth_pending: true });
    expect(out.content[0]?.text).toMatch(/oauth\/authorize/);
    // The MCP call must never have been attempted on a pending sign-in.
    expect(h.connect).not.toHaveBeenCalled();
    // Let the background dance time out and free its loopback before the next test.
    await new Promise((r) => setTimeout(r, 120));
  });

  it("browser opened but sign-in times out: surfaces the URL to retry", async () => {
    // Empty store + a tiny timeout: the browser opened, so it blocks, then times
    // out — the failure result embeds the captured URL so the user can retry.
    const tokenStore = createMemoryTokenStore();
    const execute = makeProxyExecute("deck_list_presentations", {
      createTokenStore: () => tokenStore,
      openBrowser: async () => true,
      signInTimeoutMs: 20,
    });
    const out = await execute(
      { skip: 0, limit: 10 },
      { apiBaseUrl: "https://blk.brightdeck.ai" },
      callContext(),
    );

    expect(out.details).toMatchObject({
      auth_error: expect.stringMatching(/timeout/),
    });
    expect(out.content[0]?.text).toMatch(/sign-in did not complete/i);
    expect(out.content[0]?.text).toMatch(/oauth\/authorize/);
    // The MCP call must never have been attempted on an auth failure.
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("propagates deck-formatted [code] errors without retrying", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "[validation.invalid_format] bad UUID" }],
      isError: true,
    });
    const tokenStore = freshTokenStore();
    const execute = makeProxyExecute("deck_get_presentation", {
      createTokenStore: () => tokenStore,
    });
    const err = await execute(
      { presentation_id: "x" },
      CONFIG,
      callContext(),
    ).catch((e) => e);
    expect(err.code).toBe("validation.invalid_format");
    expect(h.callTool).toHaveBeenCalledOnce();
    expect(h.connect).toHaveBeenCalledOnce();
  });
});
