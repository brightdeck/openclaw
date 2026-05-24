import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { RegisterToolFn } from "./types.js";

const TOOL_NAME = "deck_export_pdf_url";

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
});

export const registerExportPdfUrlTool: RegisterToolFn = (api, deps) => {
  api.registerTool({
    name: TOOL_NAME,
    label: "Export deck as PDF",
    description:
      "Use this when the user wants to download a deck as PDF. Converts on " +
      "demand, stores the generated export, returns a 60-minute signed URL, " +
      "and applies the server-enforced watermark policy.",
    parameters: ParametersSchema,
    // PDF conversion involves LibreOffice rendering and can take longer than
    // the default per-tool budget.
    execute: makeProxyExecute(TOOL_NAME, deps, { timeoutMs: 60_000 }),
  });
};
