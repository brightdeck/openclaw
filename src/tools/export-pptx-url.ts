import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { RegisterToolFn } from "./types.js";

const TOOL_NAME = "deck_export_pptx_url";

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
});

export const registerExportPptxUrlTool: RegisterToolFn = (api, deps) => {
  api.registerTool({
    name: TOOL_NAME,
    label: "Export deck as PPTX",
    description:
      "Use this when the user wants to download a deck as PPTX. Generates a " +
      "60-minute signed URL, may refresh the stored PPTX, and applies the " +
      "server-enforced watermark policy.",
    parameters: ParametersSchema,
    // Export prep can be slow when the stored PPTX needs to be regenerated.
    execute: makeProxyExecute(TOOL_NAME, deps, { timeoutMs: 60_000 }),
  });
};
