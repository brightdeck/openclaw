import { describe, expect, it, vi } from "vitest";

import plugin, {
  DECK_API_BASE_URL,
  PLUGIN_ID,
  PLUGIN_TOOL_REGISTRARS,
} from "../index.js";

interface RegisteredTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: unknown;
}

function createFakeApi(opts: { pluginConfig?: Record<string, unknown> } = {}) {
  const registerTool = vi.fn();
  const lookup = vi.fn(async () => undefined);
  const register = vi.fn(async () => undefined);
  const del = vi.fn(async () => false);

  const api = {
    id: PLUGIN_ID,
    pluginConfig: opts.pluginConfig,
    runtime: {
      state: {
        openKeyedStore: vi.fn(() => ({
          lookup,
          register,
          registerIfAbsent: vi.fn(),
          consume: vi.fn(),
          delete: del,
          entries: vi.fn(),
          clear: vi.fn(),
        })),
      },
    },
    registerTool,
  };
  return { api, registerTool };
}

describe("scaffold", () => {
  it("exports stable plugin identifiers", () => {
    expect(PLUGIN_ID).toBe("openclaw-deck");
    expect(DECK_API_BASE_URL).toBe("https://api.brightdeck.ai");
  });

  it("defines the plugin with the expected id, name, and description", () => {
    expect(plugin.id).toBe(PLUGIN_ID);
    expect(plugin.name).toBe("Deck");
    expect(plugin.description).toContain("Brightdeck");
    expect(typeof plugin.register).toBe("function");
  });

  it("exposes the apiBaseUrl config schema with a default", () => {
    expect(plugin.configSchema).toBeDefined();
    const anySchema = plugin.configSchema as unknown as {
      jsonSchema?: { properties?: Record<string, unknown> };
    };
    if (anySchema?.jsonSchema?.properties) {
      expect(anySchema.jsonSchema.properties).toHaveProperty("apiBaseUrl");
    }
  });

  it("registers all 11 tools when run against a fake api", () => {
    const { api, registerTool } = createFakeApi();
    plugin.register(api as never);

    expect(registerTool).toHaveBeenCalledTimes(PLUGIN_TOOL_REGISTRARS.length);
    expect(registerTool).toHaveBeenCalledTimes(11);

    const registeredNames = registerTool.mock.calls.map(
      ([tool]) => (tool as RegisteredTool).name,
    );
    expect(registeredNames.sort()).toEqual(
      [
        "deck_create_blank_presentation",
        "deck_create_presentation",
        "deck_export_pdf_url",
        "deck_export_pptx_url",
        "deck_get_presentation",
        "deck_get_share_link",
        "deck_list_permissions",
        "deck_list_presentations",
        "deck_revoke_permission",
        "deck_share_presentation",
        "deck_update_presentation",
      ].sort(),
    );
  });

  it("does NOT expose the ChatGPT-only deck_create_presentation_v2 tool", () => {
    const { api, registerTool } = createFakeApi();
    plugin.register(api as never);
    const names = registerTool.mock.calls.map(
      ([tool]) => (tool as RegisteredTool).name,
    );
    expect(names).not.toContain("deck_create_presentation_v2");
  });

  it("each tool exposes name, label, description, parameters, execute", () => {
    const { api, registerTool } = createFakeApi();
    plugin.register(api as never);
    for (const [tool] of registerTool.mock.calls) {
      const t = tool as RegisteredTool;
      expect(typeof t.name).toBe("string");
      expect(typeof t.label).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toBeDefined();
      expect(typeof t.execute).toBe("function");
    }
  });
});
