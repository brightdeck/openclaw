import type { Static, TSchema } from "typebox";
import type { ToolPluginExecutionContext } from "openclaw/plugin-sdk/tool-plugin";

import { DECK_API_BASE_URL } from "../config.js";
import { resolveAccessToken } from "./auth.js";
import { DeckClient, DeckMCPError } from "./deck-client.js";
import { createTokenStore } from "./token-store.js";

export interface PluginConfig {
  apiBaseUrl?: string;
}

export interface ProxyExecuteOptions {
  timeoutMs?: number;
}

export interface ToolContentItem {
  type: "text";
  text: string;
}

export interface ProxyAgentToolResult {
  content: ToolContentItem[];
  details: unknown;
}

export type ProxyExecute<S extends TSchema> = (
  params: Static<S>,
  config: PluginConfig,
  context: ToolPluginExecutionContext,
) => Promise<ProxyAgentToolResult>;

export function resolveApiBaseUrl(
  config: PluginConfig | undefined | null,
): string {
  const candidate = config?.apiBaseUrl;
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  return DECK_API_BASE_URL;
}

/**
 * Build an ``execute`` matching ``defineToolPlugin``'s signature:
 *
 *   (params, config, context) => Promise<ProxyAgentToolResult>
 *
 * Per call: resolve apiBaseUrl from config, open the keyed token store via
 * ``context.api``, resolve an access token (refreshing or re-authorizing as
 * needed), call ``${apiBaseUrl}/mcp`` via JSON-RPC, and map upstream
 * ``content`` / ``structuredContent`` to ``content`` / ``details``.
 *
 * On HTTP 401: clear stored tokens and re-run the OAuth dance once.
 */
export function makeProxyExecute<S extends TSchema>(
  toolName: string,
  options: ProxyExecuteOptions = {},
): ProxyExecute<S> {
  return async (params, config, context) => {
    context.signal?.throwIfAborted?.();
    const apiBaseUrl = resolveApiBaseUrl(config);
    const tokenStore = createTokenStore(context.api);

    const callOnce = async (
      accessToken: string,
    ): Promise<ProxyAgentToolResult> => {
      const client = new DeckClient({
        baseUrl: apiBaseUrl,
        accessToken,
        signal: context.signal,
        timeoutMs: options.timeoutMs,
      });
      const result = await client.callTool(
        toolName,
        params as Record<string, unknown>,
      );
      return {
        content: result.content,
        details: result.structured_content ?? null,
      };
    };

    const initialToken = await resolveAccessToken({
      apiBaseUrl,
      tokenStore,
    });
    try {
      return await callOnce(initialToken);
    } catch (err) {
      if (err instanceof DeckMCPError && err.code === "http.401") {
        await tokenStore.clear();
        const retryToken = await resolveAccessToken({
          apiBaseUrl,
          tokenStore,
        });
        return await callOnce(retryToken);
      }
      throw err;
    }
  };
}
