import { randomUUID } from "node:crypto";

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

interface JsonRpcResponse {
  result?: {
    content?: unknown;
    structuredContent?: unknown;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class DeckClient {
  constructor(private readonly opts: DeckClientOptions) {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<DeckToolResult> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}/mcp`;
    const timeout = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeout);

    try {
      const signal = mergeSignals([timeoutController.signal, this.opts.signal]);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.opts.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal,
      });

      if (!res.ok) {
        // Surface HTTP failures with status-encoded code so the tool helper
        // can branch on 401 to clear stored tokens. Body text is intentionally
        // dropped to avoid leaking refresh tokens from upstream error replies.
        throw new DeckMCPError(
          `http.${res.status}`,
          `deck MCP returned ${res.status}`,
        );
      }
      const body = (await res.json()) as JsonRpcResponse;

      if (body.error) {
        // FastMCP ``to_tool_error`` produces ``[code] message`` — preserve verbatim
        // so the upstream code stays callable by tool-call clients.
        const m = /^\[([^\]]+)\]\s+(.+)$/.exec(body.error.message ?? "");
        throw new DeckMCPError(
          m?.[1] ?? "unknown",
          m?.[2] ?? (body.error.message ?? "deck MCP error"),
        );
      }
      const result = body.result ?? {};
      return {
        content: (result.content as DeckToolResult["content"]) ?? [],
        structured_content: result.structuredContent,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        err.name === "AbortError" &&
        timeoutController.signal.aborted
      ) {
        throw new DeckMCPError(
          "http.timeout",
          `deck MCP call timed out after ${timeout}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function mergeSignals(
  signals: Array<AbortSignal | undefined>,
): AbortSignal | undefined {
  const real = signals.filter((s): s is AbortSignal => s !== undefined);
  if (real.length === 0) return undefined;
  if (real.length === 1) return real[0];
  const controller = new AbortController();
  for (const s of real) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
