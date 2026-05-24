import { describe, expect, it, vi } from "vitest";

import { createMemoryTokenStore } from "../../lib/token-store.js";
import { registerCreatePresentationTool } from "../create-presentation.js";
import { registerExportPdfUrlTool } from "../export-pdf-url.js";
import { registerExportPptxUrlTool } from "../export-pptx-url.js";
import { registerListPresentationsTool } from "../list-presentations.js";
import { registerRevokePermissionTool } from "../revoke-permission.js";

interface RegisteredTool {
  name: string;
  label: string;
  description: string;
  parameters: { type: string; properties: Record<string, unknown> };
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
}

function captureToolRegistration(
  register: (api: never, deps: never) => void,
): RegisteredTool {
  const captured: { tool?: RegisteredTool } = {};
  const api = {
    registerTool: (tool: unknown) => {
      captured.tool = tool as RegisteredTool;
    },
  };
  register(
    api as never,
    {
      apiBaseUrl: "https://api.brightdeck.ai",
      tokenStore: createMemoryTokenStore({
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 600,
        scope: "presentation:read",
        obtained_at: Math.floor(Date.now() / 1000),
      }),
    } as never,
  );
  if (!captured.tool) throw new Error("tool not registered");
  return captured.tool;
}

describe("tool registration metadata", () => {
  it("deck_list_presentations exposes skip/limit and a TypeBox object schema", () => {
    const t = captureToolRegistration(registerListPresentationsTool);
    expect(t.name).toBe("deck_list_presentations");
    expect(t.parameters.type).toBe("object");
    expect(t.parameters.properties).toHaveProperty("skip");
    expect(t.parameters.properties).toHaveProperty("limit");
  });

  it("deck_revoke_permission requires permission_id, not user_id", () => {
    const t = captureToolRegistration(registerRevokePermissionTool);
    expect(t.parameters.properties).toHaveProperty("permission_id");
    expect(t.parameters.properties).not.toHaveProperty("user_id");
  });

  it("deck_export_pptx_url and deck_export_pdf_url both expect a presentation_id", () => {
    for (const reg of [registerExportPptxUrlTool, registerExportPdfUrlTool]) {
      const t = captureToolRegistration(reg);
      expect(t.parameters.properties).toHaveProperty("presentation_id");
    }
  });

  it("deck_create_presentation accepts attachments and prompt", () => {
    const t = captureToolRegistration(registerCreatePresentationTool);
    expect(t.parameters.properties).toHaveProperty("prompt");
    expect(t.parameters.properties).toHaveProperty("attachments");
    expect(t.parameters.properties).toHaveProperty("num_slides");
    expect(t.description).toMatch(/live\s+preview/i);
  });
});

describe("tool execute (proxy) — happy path forwarded to /mcp", () => {
  const realFetch = globalThis.fetch;
  it("forwards arguments through DeckClient", async () => {
    const fetchMock = vi.fn(
      async () =>
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
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    try {
      const t = captureToolRegistration(registerListPresentationsTool);
      const out = await t.execute("c", { skip: 0, limit: 5 });
      expect(out.content[0]?.text).toBe("ok");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.brightdeck.ai/mcp");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.params.name).toBe("deck_list_presentations");
      expect(body.params.arguments).toEqual({ skip: 0, limit: 5 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
