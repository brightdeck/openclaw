import type { TSchema } from "typebox";
import type { ToolPluginToolDefinition } from "openclaw/plugin-sdk/tool-plugin";

import type { PluginConfig } from "../lib/tool-helper.js";

/**
 * Shape of a tool definition fed to ``defineToolPlugin``'s ``tools`` factory.
 * Each tool file exports one of these; ``src/index.ts`` calls ``tool(<def>)``
 * inside ``tools: (tool) => [...]``.
 */
export type DeckToolDefinition<S extends TSchema> = ToolPluginToolDefinition<
  PluginConfig,
  S
>;
