import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { DeckToolDefinition } from "./types.js";

const TOOL_NAME = "deck_update_presentation";

const VISIBILITY_VALUES = [
  "private",
  "public_view",
  "public_comment",
  "public_edit",
] as const;

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
  filename: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 255,
    }),
  ),
  visibility: Type.Optional(
    Type.Unsafe<(typeof VISIBILITY_VALUES)[number]>({
      type: "string",
      enum: [...VISIBILITY_VALUES],
      description:
        "Sharing scope. Use the web UI to delete a deck " +
        "(deleted is not accepted here).",
    }),
  ),
  show_page_numbers: Type.Optional(Type.Boolean()),
  page_number_color: Type.Optional(
    Type.String({
      pattern: "^#[0-9A-Fa-f]{6}$",
      description: "Hex color #RRGGBB.",
    }),
  ),
  page_number_font_size: Type.Optional(
    Type.Number({ minimum: 6, maximum: 72 }),
  ),
});

export const updatePresentationToolDefinition: DeckToolDefinition<
  typeof ParametersSchema
> = {
  name: TOOL_NAME,
  label: "Update presentation",
  description:
    "Use this when the user wants to rename a deck, change visibility, or " +
    "adjust page-number rendering. Requires editor or higher; deletion and " +
    "ownership transfer are intentionally excluded.",
  parameters: ParametersSchema,
  execute: makeProxyExecute(TOOL_NAME),
};
