import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { DeckToolDefinition } from "./types.js";

const TOOL_NAME = "deck_export_pptx_url";

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
});

export const exportPptxUrlToolDefinition: DeckToolDefinition<
  typeof ParametersSchema
> = {
  name: TOOL_NAME,
  label: "Export deck as PPTX",
  description:
    "Use this when the user wants to download a deck as PPTX. Generates a " +
    "60-minute signed URL, may refresh the stored PPTX, and applies the " +
    "server-enforced watermark policy.",
  parameters: ParametersSchema,
  execute: makeProxyExecute(TOOL_NAME, { timeoutMs: 60_000 }),
};
