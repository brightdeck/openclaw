import type { Static, TSchema } from "typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { ToolPluginExecutionContext } from "openclaw/plugin-sdk/tool-plugin";

import { DECK_API_BASE_URL } from "../config.js";
import { resolveAccessToken, type TokenResolution } from "./auth.js";
import { DeckClient, DeckMCPError } from "./deck-client.js";
import { createTokenStore, type TokenStore } from "./token-store.js";

export interface PluginConfig {
  apiBaseUrl?: string;
}

export interface ProxyExecuteOptions {
  timeoutMs?: number;
  /** Bounds the wait for the OAuth callback (forwarded into the dance). */
  signInTimeoutMs?: number;
  /** Test-only override; defaults to the real file-backed store. */
  createTokenStore?: (api: OpenClawPluginApi, apiBaseUrl: string) => TokenStore;
  /** Test-only override; defaults to the real browser opener. */
  openBrowser?: (url: string) => Promise<boolean>;
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
 * Per call: resolve apiBaseUrl from config, open the file-backed token store
 * (scoped to that apiBaseUrl), resolve an access token (refreshing or
 * re-authorizing as needed), call ``${apiBaseUrl}/mcp`` via JSON-RPC, and map
 * upstream ``content`` / ``structuredContent`` to ``content`` / ``details``.
 *
 * On HTTP 401: clear stored tokens and re-run the OAuth dance once.
 *
 * A failed sign-in dance (state mismatch, timeout, abort, …) is RETURNED as a
 * normal (``isError:false``) result whose text guides the user to finish
 * sign-in — the model relays that instead of framing it as a hard tool crash,
 * and the user is never silently re-prompted.
 */
export function makeProxyExecute<S extends TSchema>(
  toolName: string,
  options: ProxyExecuteOptions = {},
): ProxyExecute<S> {
  return async (params, config, context) => {
    context.signal?.throwIfAborted?.();
    const apiBaseUrl = resolveApiBaseUrl(config);
    const tokenStore = (options.createTokenStore ?? createTokenStore)(
      context.api,
      apiBaseUrl,
    );

    const pluginLog = (
      level: "info" | "warn" | "error",
      message: string,
    ): void => {
      if (level === "error") context.api.logger.error(message);
      else if (level === "warn") context.api.logger.warn(message);
      else context.api.logger.info(message);
    };

    let signInUrl: string | undefined;
    const resolveToken = (): Promise<TokenResolution> =>
      resolveAccessToken({
        apiBaseUrl,
        tokenStore,
        signal: context.signal,
        signInTimeoutMs: options.signInTimeoutMs,
        openBrowser: options.openBrowser,
        log: pluginLog,
        onAuthorizeUrl: (u) => {
          signInUrl = u;
        },
      });

    // Browser could not be opened on the gateway host (headless/SSH/CI/no
    // default browser). Surface the URL in the tool result so the model relays
    // it to the user verbatim (the structured logger is suppressed in the chat
    // TUI); the background dance keeps listening and persists the token.
    const surfacePendingSignIn = (url: string): ProxyAgentToolResult => ({
      content: [
        {
          type: "text",
          text:
            "Brightdeck needs you to sign in before this can run, but a " +
            "browser could not be opened on the gateway host. Share this " +
            "sign-in URL with the user verbatim and ask them to open it, " +
            "finish signing in, then re-run the command:\n\n" +
            url +
            "\n\nOnce they finish, the next call reuses the stored " +
            "credentials automatically.",
        },
      ],
      details: { auth_pending: true, sign_in_url: url },
    });

    const surfaceAuthFailure = (err: unknown): ProxyAgentToolResult => {
      const reason = err instanceof Error ? err.message : String(err);
      context.api.logger.error(
        `openclaw-deck: sign-in did not complete: ${reason}`,
      );
      return {
        content: [
          {
            type: "text",
            text:
              `⚠️ Brightdeck sign-in did not complete (${reason}). ` +
              (signInUrl
                ? "Share this sign-in URL with the user and ask them to finish " +
                  "signing in, then re-run:\n\n" +
                  signInUrl
                : "Re-run this command to retry sign-in."),
          },
        ],
        details: { auth_error: reason },
      };
    };

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

    let initial: TokenResolution;
    try {
      initial = await resolveToken();
    } catch (err) {
      return surfaceAuthFailure(err);
    }
    if (initial.kind === "pending-signin") {
      return surfacePendingSignIn(initial.url);
    }

    try {
      return await callOnce(initial.accessToken);
    } catch (err) {
      if (err instanceof DeckMCPError && err.code === "http.401") {
        pluginLog(
          "warn",
          `openclaw-deck: MCP call returned 401 (${err.message}); clearing token and re-authorizing once`,
        );
        await tokenStore.clear();
        let retry: TokenResolution;
        try {
          retry = await resolveToken();
        } catch (authErr) {
          return surfaceAuthFailure(authErr);
        }
        if (retry.kind === "pending-signin") {
          return surfacePendingSignIn(retry.url);
        }
        return await callOnce(retry.accessToken);
      }
      throw err;
    }
  };
}
