import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { DeckToolDefinition } from "./types.js";

const TOOL_NAME = "deck_create_blank_presentation";

const ParametersSchema = Type.Object({
  prompt: Type.Optional(
    Type.String({
      maxLength: 4000,
      description: "Optional brief used to generate the title.",
    }),
  ),
  filenames: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional reference filenames passed alongside the prompt " +
        "to the title generator.",
    }),
  ),
  show_page_numbers: Type.Optional(
    Type.Boolean({
      description: "Render page numbers on slides.",
    }),
  ),
});

export const createBlankPresentationToolDefinition: DeckToolDefinition<
  typeof ParametersSchema
> = {
  name: TOOL_NAME,
  label: "Create blank presentation",
  description:
    "Use this when the user wants an empty editable deck rather than an " +
    "AI-generated one. Creates from the bundled template and returns the " +
    "deck id, filename, slide count, and view URL.",
  parameters: ParametersSchema,
  execute: makeProxyExecute(TOOL_NAME),
};
