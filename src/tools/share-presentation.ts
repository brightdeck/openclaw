import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { DeckToolDefinition } from "./types.js";

const TOOL_NAME = "deck_share_presentation";

const ROLE_VALUES = [
  "owner",
  "admin",
  "editor",
  "commenter",
  "viewer",
] as const;

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
  email: Type.String({
    minLength: 3,
    maxLength: 320,
    description: "Target user email.",
  }),
  role: Type.Unsafe<(typeof ROLE_VALUES)[number]>({
    type: "string",
    enum: [...ROLE_VALUES],
    description:
      "Permission level to grant. Editors can grant up to editor; " +
      "only owners can grant 'owner'.",
  }),
});

export const sharePresentationToolDefinition: DeckToolDefinition<
  typeof ParametersSchema
> = {
  name: TOOL_NAME,
  label: "Share presentation",
  description:
    "Use this when the user wants to grant deck access by email. Existing " +
    "users get a permission and email; new users get an invitation. Only " +
    "owners can grant owner access.",
  parameters: ParametersSchema,
  execute: makeProxyExecute(TOOL_NAME),
};
