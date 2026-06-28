import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the REAL StreamableHTTPError / McpError classes (only the transport and
// Client are stubbed) so `instanceof` checks inside deck-client.ts resolve.
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { DeckClient, DeckMCPError } from "../deck-client.js";

// Shared, hoisted handles so the mock factories (lifted above imports by
// vitest) can reference them and each test can program the per-call SDK objects.
const h = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  terminateSession: vi.fn(),
  transport: { url: undefined as URL | undefined, opts: undefined as unknown },
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
      ...actual, // preserves the real StreamableHTTPError export
      StreamableHTTPClientTransport: vi.fn((url: URL, opts: unknown) => {
        h.transport.url = url;
        h.transport.opts = opts;
        return { terminateSession: h.terminateSession };
      }),
    };
  },
);

function authHeader(): string | undefined {
  const opts = h.transport.opts as
    | { requestInit?: { headers?: Record<string, string> } }
    | undefined;
  return opts?.requestInit?.headers?.Authorization;
}

describe("DeckClient", () => {
  beforeEach(() => {
    h.connect.mockReset().mockResolvedValue(undefined);
    h.callTool.mockReset();
    h.close.mockReset().mockResolvedValue(undefined);
    h.terminateSession.mockReset().mockResolvedValue(undefined);
    h.transport.url = undefined;
    h.transport.opts = undefined;
  });

  function client(): DeckClient {
    return new DeckClient({
      baseUrl: "https://api.brightdeck.ai",
      accessToken: "at-1",
    });
  }

  it("performs the handshake, threads the bearer, and maps content + structured_content", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { foo: "bar" },
    });

    const out = await client().callTool("deck_list_presentations", {
      skip: 0,
      limit: 10,
    });

    expect(out.content).toEqual([{ type: "text", text: "ok" }]);
    expect(out.structured_content).toEqual({ foo: "bar" });

    // The SDK handshake (initialize + initialized + session capture) ran.
    expect(h.connect).toHaveBeenCalledOnce();
    // Bearer carried via the transport's requestInit, not an authProvider.
    expect(authHeader()).toBe("Bearer at-1");
    // Canonical mounted path with the trailing slash (avoids the bare-/mcp 307).
    expect(h.transport.url?.toString()).toBe("https://api.brightdeck.ai/mcp/");
    // Tool name + args forwarded with a timeout.
    expect(h.callTool).toHaveBeenCalledWith(
      { name: "deck_list_presentations", arguments: { skip: 0, limit: 10 } },
      undefined,
      expect.objectContaining({ timeout: 30_000 }),
    );
    // Best-effort teardown of the stateful session.
    expect(h.terminateSession).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("maps a StreamableHTTPError 401 to DeckMCPError 'http.401'", async () => {
    // A 401 fires on the initialize POST during connect() (bearer on every POST).
    h.connect.mockRejectedValueOnce(
      new StreamableHTTPError(401, "Unauthorized"),
    );

    const err = await client()
      .callTool("deck_list_presentations", {})
      .catch((e) => e);

    expect(err).toBeInstanceOf(DeckMCPError);
    expect(err.code).toBe("http.401");
    // Teardown still runs even when the handshake fails.
    expect(h.terminateSession).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("maps a FastMCP isError result into DeckMCPError(code, message)", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "[presentation.not_found] no such deck" }],
      isError: true,
    });

    const err = await client()
      .callTool("deck_get_presentation", { presentation_id: "x" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(DeckMCPError);
    expect(err.code).toBe("presentation.not_found");
    expect(err.message).toBe("[presentation.not_found] no such deck");
  });

  it("maps a thrown McpError's [code] message into DeckMCPError", async () => {
    h.callTool.mockRejectedValueOnce(
      new McpError(-32603, "[validation.invalid_format] bad UUID"),
    );

    const err = await client()
      .callTool("deck_get_presentation", { presentation_id: "x" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(DeckMCPError);
    expect(err.code).toBe("validation.invalid_format");
    expect(err.message).toContain("bad UUID");
  });

  it("falls back to code 'unknown' when the error text has no [code] prefix", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "some unstructured failure" }],
      isError: true,
    });

    const err = await client()
      .callTool("deck_get_presentation", { presentation_id: "x" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(DeckMCPError);
    expect(err.code).toBe("unknown");
    expect(err.message).toContain("some unstructured failure");
  });
});
