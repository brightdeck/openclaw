import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";

import { DECK_API_BASE_URL, PLUGIN_ID } from "./config.js";
import type { ProxyToolDeps } from "./lib/tool-helper.js";
import { createTokenStore } from "./lib/token-store.js";
import { registerCreateBlankPresentationTool } from "./tools/create-blank-presentation.js";
import { registerCreatePresentationTool } from "./tools/create-presentation.js";
import { registerExportPdfUrlTool } from "./tools/export-pdf-url.js";
import { registerExportPptxUrlTool } from "./tools/export-pptx-url.js";
import { registerGetPresentationTool } from "./tools/get-presentation.js";
import { registerGetShareLinkTool } from "./tools/get-share-link.js";
import { registerListPermissionsTool } from "./tools/list-permissions.js";
import { registerListPresentationsTool } from "./tools/list-presentations.js";
import { registerRevokePermissionTool } from "./tools/revoke-permission.js";
import { registerSharePresentationTool } from "./tools/share-presentation.js";
import { registerUpdatePresentationTool } from "./tools/update-presentation.js";
import type { RegisterToolFn } from "./tools/types.js";

export { DECK_API_BASE_URL, PLUGIN_ID };

const configSchemaJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    apiBaseUrl: {
      type: "string",
      default: DECK_API_BASE_URL,
    },
  },
} as const;

const ALL_TOOL_REGISTRARS: RegisterToolFn[] = [
  registerListPresentationsTool,
  registerGetPresentationTool,
  registerGetShareLinkTool,
  registerCreateBlankPresentationTool,
  registerUpdatePresentationTool,
  registerExportPptxUrlTool,
  registerExportPdfUrlTool,
  registerListPermissionsTool,
  registerSharePresentationTool,
  registerRevokePermissionTool,
  registerCreatePresentationTool,
];

/** Exported for tests; matches the order tools register with the api. */
export const PLUGIN_TOOL_REGISTRARS: ReadonlyArray<RegisterToolFn> =
  ALL_TOOL_REGISTRARS;

function resolveApiBaseUrl(pluginConfig: Record<string, unknown> | undefined) {
  const candidate = pluginConfig?.apiBaseUrl;
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  return DECK_API_BASE_URL;
}

function registerAllTools(
  api: OpenClawPluginApi,
  deps: ProxyToolDeps,
): void {
  for (const register of ALL_TOOL_REGISTRARS) {
    register(api, deps);
  }
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Deck",
  description: "Build and manage presentations on Brightdeck.",
  configSchema: buildJsonPluginConfigSchema(configSchemaJson, {
    uiHints: {
      apiBaseUrl: {
        label: "deck API base URL",
        help: "Override only if you self-host deck.",
        placeholder: DECK_API_BASE_URL,
      },
    },
  }),
  register: (api) => {
    const apiBaseUrl = resolveApiBaseUrl(api.pluginConfig);
    const tokenStore = createTokenStore(api);
    registerAllTools(api, { apiBaseUrl, tokenStore });
  },
});
