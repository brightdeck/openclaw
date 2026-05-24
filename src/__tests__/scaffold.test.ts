import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it, vi } from "vitest";

import plugin, {
  DECK_API_BASE_URL,
  PLUGIN_ID,
  PLUGIN_TOOL_DEFINITIONS,
} from "../index.js";

const EXPECTED_TOOL_NAMES = [
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
].sort();

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
    const schema = plugin.configSchema as unknown as {
      jsonSchema?: { properties?: Record<string, unknown> };
    };
    expect(schema.jsonSchema?.properties).toHaveProperty("apiBaseUrl");
  });

  it("static tool-plugin metadata lists all 11 tools", () => {
    const metadata = getToolPluginMetadata(plugin);
    expect(metadata).toBeDefined();
    expect(metadata?.id).toBe(PLUGIN_ID);
    expect(metadata?.tools).toHaveLength(11);
    expect(metadata?.tools.map((t) => t.name).sort()).toEqual(
      EXPECTED_TOOL_NAMES,
    );
  });

  it("static metadata does NOT expose the ChatGPT-only v2 tool", () => {
    const metadata = getToolPluginMetadata(plugin);
    const names = metadata?.tools.map((t) => t.name) ?? [];
    expect(names).not.toContain("deck_create_presentation_v2");
  });

  it("each static tool entry has name/label/description/parameters", () => {
    const metadata = getToolPluginMetadata(plugin);
    for (const t of metadata?.tools ?? []) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.label).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toBeDefined();
    }
  });

  it("PLUGIN_TOOL_DEFINITIONS matches the registered tool count", () => {
    expect(PLUGIN_TOOL_DEFINITIONS).toHaveLength(11);
    expect(PLUGIN_TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual(
      EXPECTED_TOOL_NAMES,
    );
  });

  it("runtime register hook still registers 11 tools against the api", () => {
    const { api, registerTool } = createFakeApi();
    plugin.register(api as never);
    expect(registerTool).toHaveBeenCalledTimes(11);
    const registeredNames = registerTool.mock.calls.map(
      ([toolOrFactory]) =>
        (toolOrFactory as { name?: string }).name ?? "<factory>",
    );
    expect(registeredNames.sort()).toEqual(EXPECTED_TOOL_NAMES);
  });
});
