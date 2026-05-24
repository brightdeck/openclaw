import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { DeckToolDefinition } from "./types.js";

const TOOL_NAME = "deck_list_presentations";

const ParametersSchema = Type.Object({
  skip: Type.Optional(
    Type.Number({ minimum: 0, default: 0, description: "Pagination offset." }),
  ),
  limit: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 50,
      default: 25,
      description: "Page size (1-50).",
    }),
  ),
});

export const listPresentationsToolDefinition: DeckToolDefinition<
  typeof ParametersSchema
> = {
  name: TOOL_NAME,
  label: "List presentations",
  description:
    "Use this when the user wants to browse decks they can access. " +
    "Returns a newest-first page with ids, filenames, slide counts, " +
    "visibility, thumbnail URIs, view URLs, and the caller's role.",
  parameters: ParametersSchema,
  execute: makeProxyExecute(TOOL_NAME),
};
