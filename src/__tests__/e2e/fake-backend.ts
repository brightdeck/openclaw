// A hermetic, loopback-only stand-in for the deck backend, used by the OAuth +
// MCP end-to-end test. Raw `node:http` (no msw) plus a REAL `McpServer` so the
// test exercises the same SDK handshake the plugin uses in production:
//
//   GET  /oauth/authorize  -> 302 to <redirect_uri>?code=…&state=…
//   POST /oauth/token      -> PKCE S256 + exact redirect_uri verify, then a
//                             {access_token, token_type, expires_in, refresh_token, scope}
//   *    /mcp[/]           -> Bearer-gated StreamableHTTPServerTransport; one
//                             tool that returns content "ok".
import { createHash, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

export interface FakeBackend {
  apiBaseUrl: string;
  accessToken: string;
  refreshToken: string;
  close: () => Promise<void>;
}

const ACCESS_TOKEN = "e2e-access-token";
const REFRESH_TOKEN = "e2e-refresh-token";
const SCOPE = "presentation:read presentation:write agent:run";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakeBackend(): Promise<FakeBackend> {
  // Issued authorization codes -> the PKCE challenge + redirect they were
  // minted against (both re-verified at the token endpoint).
  const codes = new Map<string, { codeChallenge: string; redirectUri: string }>();
  // Live MCP sessions keyed by the SDK-generated session id.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  function sendToken(res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        access_token: ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 600,
        refresh_token: REFRESH_TOKEN,
        scope: SCOPE,
      }),
    );
  }

  function handleAuthorize(url: URL, res: ServerResponse): void {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const codeChallenge = url.searchParams.get("code_challenge");
    if (!redirectUri || !state || !codeChallenge) {
      res.statusCode = 400;
      res.end("missing authorize params");
      return;
    }
    const code = randomUUID();
    codes.set(code, { codeChallenge, redirectUri });
    const dest = new URL(redirectUri);
    dest.searchParams.set("code", code);
    dest.searchParams.set("state", state);
    res.statusCode = 302;
    res.setHeader("Location", dest.toString());
    res.end();
  }

  async function handleToken(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    if (form.get("grant_type") === "refresh_token") {
      if (form.get("refresh_token") !== REFRESH_TOKEN) {
        res.statusCode = 400;
        res.end("bad refresh token");
        return;
      }
      sendToken(res);
      return;
    }
    // authorization_code grant: re-verify PKCE + the exact redirect_uri.
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const stored = codes.get(code);
    if (!stored) {
      res.statusCode = 400;
      res.end("unknown code");
      return;
    }
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    if (challenge !== stored.codeChallenge) {
      res.statusCode = 400;
      res.end("pkce mismatch");
      return;
    }
    if (redirectUri !== stored.redirectUri) {
      res.statusCode = 400;
      res.end("redirect_uri mismatch");
      return;
    }
    codes.delete(code);
    sendToken(res);
  }

  async function handleMcp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.headers["authorization"] !== `Bearer ${ACCESS_TOKEN}`) {
      res.statusCode = 401;
      res.setHeader(
        "WWW-Authenticate",
        'Bearer resource_metadata="http://127.0.0.1/.well-known/oauth-protected-resource/mcp"',
      );
      res.end();
      return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;
    const body = req.method === "POST" ? await readBody(req) : "";
    const parsed = body ? JSON.parse(body) : undefined;

    if (!transport) {
      if (req.method === "POST" && isInitializeRequest(parsed)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            transports.set(sid, transport!);
          },
        });
        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) transports.delete(sid);
        };
        const mcp = new McpServer({ name: "fake-deck", version: "0.0.0" });
        mcp.registerTool(
          "deck_list_presentations",
          { description: "fake deck tool" },
          async () => ({ content: [{ type: "text", text: "ok" }] }),
        );
        await mcp.connect(transport);
      } else {
        res.statusCode = 400;
        res.end("no MCP session");
        return;
      }
    }
    await transport.handleRequest(req, res, parsed);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const route =
      req.method === "GET" && path === "/oauth/authorize"
        ? handleAuthorize(url, res)
        : req.method === "POST" && path === "/oauth/token"
          ? handleToken(req, res)
          : path === "/mcp" || path === "/mcp/"
            ? handleMcp(req, res)
            : ((): void => {
                res.statusCode = 404;
                res.end();
              })();
    Promise.resolve(route).catch((err: unknown) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(String(err));
      }
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const addr = server.address() as AddressInfo;

  return {
    apiBaseUrl: `http://127.0.0.1:${addr.port}`,
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of transports.values()) void t.close();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
