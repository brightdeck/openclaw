import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { RegisterToolFn } from "./types.js";

const TOOL_NAME = "deck_revoke_permission";

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
  permission_id: Type.String({
    description: "UUID of the permission row to revoke.",
  }),
});

export const registerRevokePermissionTool: RegisterToolFn = (api, deps) => {
  api.registerTool({
    name: TOOL_NAME,
    label: "Revoke permission",
    description:
      "Use this when the user wants to remove a collaborator from a deck. " +
      "Destructive — applies role-based safeguards and cannot revoke the " +
      "caller's own permission.",
    parameters: ParametersSchema,
    execute: makeProxyExecute(TOOL_NAME, deps),
  });
};
