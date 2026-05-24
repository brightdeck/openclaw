import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import type { ProxyToolDeps } from "../lib/tool-helper.js";

/** Per-tool registration callback signature. */
export type RegisterToolFn = (
  api: OpenClawPluginApi,
  deps: ProxyToolDeps,
) => void;
