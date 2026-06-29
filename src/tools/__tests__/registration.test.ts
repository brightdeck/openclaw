import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLUGIN_ID } from "../../config.js";
import type { OAuthResult } from "../../lib/oauth.js";
import { createFileTokenStore } from "../../lib/token-store.js";
import { createPresentationToolDefinition } from "../create-presentation.js";
import { exportPdfUrlToolDefinition } from "../export-pdf-url.js";
import { exportPptxUrlToolDefinition } from "../export-pptx-url.js";
import { listPresentationsToolDefinition } from "../list-presentations.js";
import { revokePermissionToolDefinition } from "../revoke-permission.js";

// Hoisted SDK handles — the per-call DeckClient now drives the MCP SDK
// transport, not globalThis.fetch, so the proxy test mocks at the SDK level.
const h = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  terminateSession: vi.fn(),
  transport: { url: undefined as URL | undefined },
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
      StreamableHTTPClientTransport: vi.fn((url: URL) => {
        h.transport.url = url;
        return { terminateSession: h.terminateSession };
      }),
    };
  },
);

interface ParamsShape {
  type: string;
  properties: Record<string, unknown>;
}

const SEED_TOKEN: OAuthResult = {
  access_token: "at-1",
  refresh_token: "rt-1",
  expires_in: 600,
  scope: "presentation:read",
  obtained_at: Math.floor(Date.now() / 1000),
};

/**
 * Minimal fake ``context.api``. The proxy reads its token from the real
 * file-backed store (seeded per-test under a temp OPENCLAW_STATE_DIR), so the
 * api only needs the logger the store factory closes over.
 */
function createFakeApi() {
  return {
    id: PLUGIN_ID,
    pluginConfig: { apiBaseUrl: "https://api.brightdeck.ai" },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerTool: vi.fn(),
  };
}

describe("tool definition metadata", () => {
  it("deck_list_presentations exposes skip/limit and a TypeBox object schema", () => {
    const t = listPresentationsToolDefinition;
    expect(t.name).toBe("deck_list_presentations");
    const params = t.parameters as ParamsShape;
    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("skip");
    expect(params.properties).toHaveProperty("limit");
  });

  it("deck_revoke_permission requires permission_id, not user_id", () => {
    const params = revokePermissionToolDefinition.parameters as ParamsShape;
    expect(params.properties).toHaveProperty("permission_id");
    expect(params.properties).not.toHaveProperty("user_id");
  });

  it("deck_export_pptx_url and deck_export_pdf_url both expect presentation_id", () => {
    for (const def of [exportPptxUrlToolDefinition, exportPdfUrlToolDefinition]) {
      const params = def.parameters as ParamsShape;
      expect(params.properties).toHaveProperty("presentation_id");
    }
  });

  it("deck_create_presentation accepts attachments and prompt", () => {
    const t = createPresentationToolDefinition;
    const params = t.parameters as ParamsShape;
    expect(params.properties).toHaveProperty("prompt");
    expect(params.properties).toHaveProperty("attachments");
    expect(params.properties).toHaveProperty("num_slides");
    expect(t.description).toMatch(/live\s+preview/i);
  });
});

describe("tool execute (proxy) — happy path forwarded to /mcp", () => {
  let tmp: string;
  let savedStateDir: string | undefined;

  beforeEach(async () => {
    h.connect.mockReset().mockResolvedValue(undefined);
    h.callTool.mockReset();
    h.close.mockReset().mockResolvedValue(undefined);
    h.terminateSession.mockReset().mockResolvedValue(undefined);
    h.transport.url = undefined;

    // Seed a fresh token into the real file store the proxy will read back.
    savedStateDir = process.env.OPENCLAW_STATE_DIR;
    tmp = mkdtempSync(join(tmpdir(), "ocd-reg-"));
    process.env.OPENCLAW_STATE_DIR = tmp;
    await createFileTokenStore("https://api.brightdeck.ai").save(SEED_TOKEN);
  });

  afterEach(() => {
    if (savedStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = savedStateDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("forwards arguments through DeckClient", async () => {
    h.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { items: [] },
    });

    const def = listPresentationsToolDefinition;
    if (!def.execute) throw new Error("expected execute on tool definition");

    const api = createFakeApi();
    const out = await def.execute(
      { skip: 0, limit: 5 },
      { apiBaseUrl: "https://api.brightdeck.ai" },
      { api: api as never, toolCallId: "c" },
    );

    const result = out as { content: Array<{ text: string }> };
    expect(result.content[0]?.text).toBe("ok");

    // Canonical mounted path (trailing slash) and forwarded tool + args.
    expect(h.transport.url?.toString()).toBe("https://api.brightdeck.ai/mcp/");
    expect(h.callTool).toHaveBeenCalledWith(
      { name: "deck_list_presentations", arguments: { skip: 0, limit: 5 } },
      undefined,
      expect.anything(),
    );
  });
});
