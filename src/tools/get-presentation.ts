import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { DeckToolDefinition } from "./types.js";

const TOOL_NAME = "deck_get_presentation";

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
});

export const getPresentationToolDefinition: DeckToolDefinition<
  typeof ParametersSchema
> = {
  name: TOOL_NAME,
  label: "Get presentation",
  description:
    "Use this when the user needs details for one known deck id. Returns " +
    "filename, slide count, visibility, thumbnail URI, view URL, and the " +
    "caller role, or an access/not-found error.",
  parameters: ParametersSchema,
  execute: makeProxyExecute(TOOL_NAME),
};
