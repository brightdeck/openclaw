import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { DeckToolDefinition } from "./types.js";

const TOOL_NAME = "deck_export_pdf_url";

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
});

export const exportPdfUrlToolDefinition: DeckToolDefinition<
  typeof ParametersSchema
> = {
  name: TOOL_NAME,
  label: "Export deck as PDF",
  description:
    "Use this when the user wants to download a deck as PDF. Converts on " +
    "demand, stores the generated export, returns a 60-minute signed URL, " +
    "and applies the server-enforced watermark policy.",
  parameters: ParametersSchema,
  execute: makeProxyExecute(TOOL_NAME, { timeoutMs: 60_000 }),
};
