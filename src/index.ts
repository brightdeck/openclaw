import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import { DECK_API_BASE_URL, PLUGIN_ID } from "./config.js";
import { createBlankPresentationToolDefinition } from "./tools/create-blank-presentation.js";
import { createPresentationToolDefinition } from "./tools/create-presentation.js";
import { exportPdfUrlToolDefinition } from "./tools/export-pdf-url.js";
import { exportPptxUrlToolDefinition } from "./tools/export-pptx-url.js";
import { getPresentationToolDefinition } from "./tools/get-presentation.js";
import { getShareLinkToolDefinition } from "./tools/get-share-link.js";
import { listPermissionsToolDefinition } from "./tools/list-permissions.js";
import { listPresentationsToolDefinition } from "./tools/list-presentations.js";
import { revokePermissionToolDefinition } from "./tools/revoke-permission.js";
import { sharePresentationToolDefinition } from "./tools/share-presentation.js";
import { updatePresentationToolDefinition } from "./tools/update-presentation.js";

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

/** Static list of tool definitions in registration order; exported for tests. */
export const PLUGIN_TOOL_DEFINITIONS = [
  listPresentationsToolDefinition,
  getPresentationToolDefinition,
  getShareLinkToolDefinition,
  createBlankPresentationToolDefinition,
  updatePresentationToolDefinition,
  exportPptxUrlToolDefinition,
  exportPdfUrlToolDefinition,
  listPermissionsToolDefinition,
  sharePresentationToolDefinition,
  revokePermissionToolDefinition,
  createPresentationToolDefinition,
] as const;

export default defineToolPlugin({
  id: PLUGIN_ID,
  name: "Deck",
  description: "Build and manage presentations on Brightdeck.",
  configSchema: configSchemaJson,
  tools: (tool) => [
    tool(listPresentationsToolDefinition),
    tool(getPresentationToolDefinition),
    tool(getShareLinkToolDefinition),
    tool(createBlankPresentationToolDefinition),
    tool(updatePresentationToolDefinition),
    tool(exportPptxUrlToolDefinition),
    tool(exportPdfUrlToolDefinition),
    tool(listPermissionsToolDefinition),
    tool(sharePresentationToolDefinition),
    tool(revokePermissionToolDefinition),
    tool(createPresentationToolDefinition),
  ],
});
