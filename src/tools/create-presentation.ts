import { Type } from "typebox";

import { makeProxyExecute } from "../lib/tool-helper.js";
import type { RegisterToolFn } from "./types.js";

const TOOL_NAME = "deck_create_presentation";

const PRESENTATION_STYLES = [
  "auto",
  "corporate",
  "elegant",
  "creative",
] as const;

const CONTENT_DENSITIES = [
  "concise",
  "light",
  "normal",
  "dense",
  "extra_dense",
] as const;

const ATTACHMENT_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
] as const;

const AttachmentSchema = Type.Object({
  filename: Type.String({
    minLength: 1,
    maxLength: 255,
    description: "Original filename (1-255 chars).",
  }),
  content_type: Type.Unsafe<(typeof ATTACHMENT_MIMES)[number]>({
    type: "string",
    enum: [...ATTACHMENT_MIMES],
    description:
      "MIME type. Allowed: pdf, pptx, docx, xlsx, txt, markdown, csv, png, jpeg.",
  }),
  base64_content: Type.String({
    minLength: 1,
    description:
      "Standard or URL-safe base64 of the file bytes (≤ 20 MB decoded).",
  }),
});

const ParametersSchema = Type.Object({
  prompt: Type.String({
    minLength: 1,
    maxLength: 4000,
    description: "Natural-language brief for the deck (1-4000 chars).",
  }),
  num_slides: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 50,
      description:
        "Total slide count. Plan caps: free=10, plus=15, pro=25, ultra=50. " +
        "Omit to let the agent decide (typically 5-7).",
    }),
  ),
  theme_id: Type.Optional(
    Type.String({
      description:
        "Optional system theme UUID. Omit unless you have a known UUID.",
    }),
  ),
  presentation_style: Type.Optional(
    Type.Unsafe<(typeof PRESENTATION_STYLES)[number]>({
      type: "string",
      enum: [...PRESENTATION_STYLES],
      description:
        "Visual direction. 'auto' lets the agent infer; 'corporate' = " +
        "data-rich; 'elegant' = minimal; 'creative' = vibrant illustrations.",
    }),
  ),
  content_density: Type.Optional(
    Type.Unsafe<(typeof CONTENT_DENSITIES)[number]>({
      type: "string",
      enum: [...CONTENT_DENSITIES],
      description:
        "Text load per slide. concise≈3 key points, light≈4, normal≈5, " +
        "dense≈7, extra_dense≈9.",
    }),
  ),
  attachments: Type.Optional(
    Type.Array(AttachmentSchema, {
      maxItems: 5,
      description: "Up to 5 reference files, each ≤ 20 MB.",
    }),
  ),
});

export const registerCreatePresentationTool: RegisterToolFn = (api, deps) => {
  api.registerTool({
    name: TOOL_NAME,
    label: "Generate presentation",
    description:
      "Use this when the user wants to generate a complete presentation " +
      "from a prompt and any base64 reference files. Returns a live " +
      "preview URL the user can open immediately to watch slides appear " +
      "over 30-120 seconds. Generation continues in the background.",
    parameters: ParametersSchema,
    // The call itself returns in a few seconds (the server validates
    // attachments synchronously before kicking the background task), but
    // large attachments push that past the 30s default.
    execute: makeProxyExecute(TOOL_NAME, deps, { timeoutMs: 180_000 }),
  });
};
