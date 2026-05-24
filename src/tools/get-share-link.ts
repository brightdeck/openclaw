import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { RegisterToolFn } from "./types.js";

const TOOL_NAME = "deck_get_share_link";

const ParametersSchema = Type.Object({
  presentation_id: Type.String({
    description: "UUID of the presentation.",
  }),
});

export const registerGetShareLinkTool: RegisterToolFn = (api, deps) => {
  api.registerTool({
    name: TOOL_NAME,
    label: "Get share link",
    description:
      "Use this when the user asks for a deck link or sharing visibility. " +
      "Returns the canonical view URL, visibility, and whether the link is " +
      "publicly viewable.",
    parameters: ParametersSchema,
    execute: makeProxyExecute(TOOL_NAME, deps),
  });
};
