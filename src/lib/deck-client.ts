import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { PLUGIN_VERSION } from "../config.js";

export interface DeckClientOptions {
  baseUrl: string;
  accessToken: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DeckToolResult {
  content: Array<{ type: "text"; text: string }>;
  structured_content?: unknown;
}

export class DeckMCPError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = "DeckMCPError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Matches FastMCP's ``[code] message`` tool-error format anywhere in a string. */
const CODE_MESSAGE_RE = /\[([^\]]+)\]\s+([\s\S]+)/;

interface ToolResultContentItem {
  type?: string;
  text?: unknown;
}

interface CallToolResultLike {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * Thin wrapper over the official MCP SDK's Streamable-HTTP client.
 *
 * Each ``callTool`` opens a fresh ``Client`` + ``StreamableHTTPClientTransport``,
 * which performs the MCP ``initialize`` → ``notifications/initialized`` handshake
 * and captures the ``mcp-session-id`` that deck's stateful server requires before
 * a ``tools/call``. The SDK also sends the dual ``Accept: application/json,
 * text/event-stream`` header and transparently parses both JSON and SSE replies,
 * which the previous hand-rolled JSON-only POST could not.
 *
 * deck keeps its own OAuth dance (``oauth.ts``); the SDK only carries the
 * resulting bearer via ``requestInit.headers.Authorization`` (no ``authProvider``,
 * so the SDK never runs an OAuth flow of its own).
 */
export class DeckClient {
  constructor(private readonly opts: DeckClientOptions) {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<DeckToolResult> {
    // Trailing slash → hit the canonical mounted path directly, avoiding the
    // bare-/mcp 307 that MCPPathNormalizationMiddleware rewrites server-side.
    const url = new URL(`${this.opts.baseUrl.replace(/\/+$/, "")}/mcp/`);
    const client = new Client({
      name: "openclaw-deck",
      version: PLUGIN_VERSION,
    });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: { Authorization: `Bearer ${this.opts.accessToken}` },
      },
    });

    try {
      // initialize + notifications/initialized + capture mcp-session-id.
      await client.connect(transport, { signal: this.opts.signal });
      const result = (await client.callTool(
        { name, arguments: args },
        undefined,
        {
          signal: this.opts.signal,
          timeout: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        },
      )) as CallToolResultLike;

      if (result.isError) {
        // FastMCP tool errors come back as an isError result whose text is
        // ``[code] message`` (MCP lowlevel server `_make_error_result`).
        throw mapToolError(result);
      }
      return {
        content: (result.content as DeckToolResult["content"]) ?? [],
        structured_content: result.structuredContent,
      };
    } catch (err) {
      throw toDeckError(err);
    } finally {
      // Best-effort teardown of the stateful session. A DELETE that lands on a
      // worker without the session 404s; swallow it — the session expires
      // server-side regardless (same behaviour as Claude.ai/ChatGPT).
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  }
}

/** Build a ``DeckMCPError`` from a FastMCP isError result's ``[code] message`` text. */
function mapToolError(result: CallToolResultLike): DeckMCPError {
  const text = extractText(result.content);
  return parseDeckError(text, text || "deck MCP tool error");
}

/** Normalise any thrown error into a ``DeckMCPError`` (or pass through). */
function toDeckError(err: unknown): Error {
  if (err instanceof DeckMCPError) {
    return err; // already mapped (the isError branch above)
  }
  if (err instanceof StreamableHTTPError) {
    // The HTTP status surfaces as ``.code``; mapping 401 → http.401 preserves
    // tool-helper's clear-token + re-auth-once retry.
    const code = err.code ?? "unknown";
    return new DeckMCPError(`http.${code}`, `deck MCP returned ${code}`);
  }
  if (err instanceof McpError) {
    if (err.code === ErrorCode.RequestTimeout) {
      return new DeckMCPError("http.timeout", "deck MCP call timed out");
    }
    return parseDeckError(err.message, err.message);
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new DeckMCPError("http.timeout", "deck MCP call timed out");
  }
  return err instanceof Error ? err : new Error(String(err));
}

function parseDeckError(text: string, fallbackMessage: string): DeckMCPError {
  const m = CODE_MESSAGE_RE.exec(text);
  return new DeckMCPError(
    m?.[1] ?? "unknown",
    m?.[2]?.trim() ?? fallbackMessage,
  );
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const it = item as ToolResultContentItem;
      return typeof it?.text === "string" ? it.text : "";
    })
    .join("")
    .trim();
}
