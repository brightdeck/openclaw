import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeckClient, DeckMCPError } from "../deck-client.js";

describe("DeckClient", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function client(): DeckClient {
    return new DeckClient({
      baseUrl: "https://api.brightdeck.ai",
      accessToken: "at-1",
    });
  }

  it("posts a JSON-RPC tools/call envelope and returns content + structured_content", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            content: [{ type: "text", text: "ok" }],
            structuredContent: { foo: "bar" },
          },
        }),
        { status: 200 },
      ),
    );
    const out = await client().callTool("deck_list_presentations", {
      skip: 0,
      limit: 10,
    });
    expect(out.content).toEqual([{ type: "text", text: "ok" }]);
    expect(out.structured_content).toEqual({ foo: "bar" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.brightdeck.ai/mcp");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer at-1");
    const body = JSON.parse(init.body);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("deck_list_presentations");
    expect(body.params.arguments).toEqual({ skip: 0, limit: 10 });
  });

  it("surfaces 401 as DeckMCPError with code 'http.401'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("unauthorized", { status: 401 }),
    );
    const err = await client()
      .callTool("deck_list_presentations", {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(DeckMCPError);
    expect(err.code).toBe("http.401");
  });

  it("surfaces deck-formatted error code from the JSON-RPC error envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          error: {
            code: -32602,
            message: "[presentation.not_found] no such deck",
          },
        }),
        { status: 200 },
      ),
    );
    const err = await client()
      .callTool("deck_get_presentation", { presentation_id: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(DeckMCPError);
    expect(err.code).toBe("presentation.not_found");
    expect(err.message).toBe("[presentation.not_found] no such deck");
  });

  it("uses 'unknown' as the code when the upstream error doesn't follow the [code] prefix", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          error: { code: -32603, message: "some unstructured failure" },
        }),
        { status: 200 },
      ),
    );
    const err = await client()
      .callTool("deck_get_presentation", { presentation_id: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(DeckMCPError);
    expect(err.code).toBe("unknown");
    expect(err.message).toContain("some unstructured failure");
  });

  it("times out long-running upstream calls with code 'http.timeout'", async () => {
    fetchMock.mockImplementationOnce(
      (_input, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    const c = new DeckClient({
      baseUrl: "https://api.brightdeck.ai",
      accessToken: "at-1",
      timeoutMs: 25,
    });
    const err = await c
      .callTool("deck_list_presentations", {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(DeckMCPError);
    expect(err.code).toBe("http.timeout");
  });
});
