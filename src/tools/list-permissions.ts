import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { RegisterToolFn } from "./types.js";

const TOOL_NAME = "deck_list_permissions";

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
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

export const registerListPermissionsTool: RegisterToolFn = (api, deps) => {
  api.registerTool({
    name: TOOL_NAME,
    label: "List permissions",
    description:
      "Use this when the user wants to see collaborators on a deck. Requires " +
      "editor or higher access and returns permission ids, roles, user emails, " +
      "and pagination metadata.",
    parameters: ParametersSchema,
    execute: makeProxyExecute(TOOL_NAME, deps),
  });
};
