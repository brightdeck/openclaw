import type { Static, TSchema } from "typebox";

import { resolveAccessToken } from "./auth.js";
import { DeckClient, DeckMCPError } from "./deck-client.js";
import type { TokenStore } from "./token-store.js";

export interface ProxyToolDeps {
  apiBaseUrl: string;
  tokenStore: TokenStore;
}

export interface ProxyExecuteOptions {
  timeoutMs?: number;
}

/** Shape of a single content item the agent runtime accepts on AgentToolResult. */
export interface ToolContentItem {
  type: "text";
  text: string;
}

export interface ProxyAgentToolResult {
  content: ToolContentItem[];
  details: unknown;
}

/**
 * Build an ``execute`` function compatible with ``AgentTool.execute``:
 *
 *   (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult>
 *
 * The helper resolves an access token (refreshing or re-authorizing as
 * needed), calls ``${apiBaseUrl}/mcp`` via JSON-RPC, and maps the upstream
 * ``content`` / ``structuredContent`` to the agent runtime's
 * ``content`` / ``details`` envelope.
 *
 * On HTTP 401 it clears the stored tokens and re-runs the OAuth dance once.
 */
export function makeProxyExecute<S extends TSchema>(
  toolName: string,
  deps: ProxyToolDeps,
  options: ProxyExecuteOptions = {},
) {
  return async function execute(
    _toolCallId: string,
    params: Static<S>,
    signal?: AbortSignal,
  ): Promise<ProxyAgentToolResult> {
    signal?.throwIfAborted?.();

    const callOnce = async (
      accessToken: string,
    ): Promise<ProxyAgentToolResult> => {
      const client = new DeckClient({
        baseUrl: deps.apiBaseUrl,
        accessToken,
        signal,
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
      apiBaseUrl: deps.apiBaseUrl,
      tokenStore: deps.tokenStore,
    });
    try {
      return await callOnce(initialToken);
    } catch (err) {
      // Refresh-on-401: covers server-side revocation between the cached
      // access-token issuance and this call. Clear stored state and re-auth
      // once — a second 401 surfaces to the caller.
      if (err instanceof DeckMCPError && err.code === "http.401") {
        await deps.tokenStore.clear();
        const retryToken = await resolveAccessToken({
          apiBaseUrl: deps.apiBaseUrl,
          tokenStore: deps.tokenStore,
        });
        return await callOnce(retryToken);
      }
      throw err;
    }
  };
}
