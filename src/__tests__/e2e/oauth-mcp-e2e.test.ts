import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccessToken } from "../../lib/auth.js";
import { DeckClient } from "../../lib/deck-client.js";
import { createTokenStore } from "../../lib/token-store.js";
import { startFakeBackend, type FakeBackend } from "./fake-backend.js";

/** Where the production file store writes under a given state dir. */
function tokenFile(stateDir: string): string {
  return join(stateDir, "plugin-state", "openclaw-deck", "oauth.json");
}

// The file store only ever touches `api.logger`; everything else is unused.
const fakeApi = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as never;

describe("oauth + mcp end-to-end (real file store, real MCP server)", () => {
  let backend: FakeBackend;
  let tmp: string;
  let savedStateDir: string | undefined;

  beforeEach(async () => {
    savedStateDir = process.env.OPENCLAW_STATE_DIR;
    tmp = mkdtempSync(join(tmpdir(), "ocd-e2e-"));
    process.env.OPENCLAW_STATE_DIR = tmp;
    backend = await startFakeBackend();
  });

  afterEach(async () => {
    await backend.close();
    if (savedStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = savedStateDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("signs in once, persists a 0600 token file, then calls an MCP tool", async () => {
    const tokenStore = createTokenStore(fakeApi, backend.apiBaseUrl);

    // Drive the real resolver; capture the authorize URL it emits.
    let authorizeUrl = "";
    const flow = resolveAccessToken({
      apiBaseUrl: backend.apiBaseUrl,
      tokenStore,
      log: (_level, msg) => {
        const m = /(https?:\/\/\S+)/.exec(msg);
        if (m && !authorizeUrl) authorizeUrl = m[1]!;
      },
    });

    // "Play the browser": follow the authorize 302 to the loopback callback,
    // which fires the plugin's callback server and resolves the dance.
    await vi.waitFor(() => expect(authorizeUrl).not.toBe(""));
    const authorizeRes = await fetch(authorizeUrl, { redirect: "manual" });
    expect(authorizeRes.status).toBe(302);
    const location = authorizeRes.headers.get("location");
    expect(location).toBeTruthy();
    await fetch(location!);

    const accessToken = await flow;
    expect(accessToken).toBe(backend.accessToken);

    // The token landed on disk: v:1, scoped to this backend, 0600.
    const file = tokenFile(tmp);
    expect(existsSync(file)).toBe(true);
    const blob = JSON.parse(readFileSync(file, "utf8"));
    expect(blob.v).toBe(1);
    expect(blob.apiBaseUrl).toBe(backend.apiBaseUrl);
    expect(blob.token.access_token).toBe(backend.accessToken);
    expect(blob.token.refresh_token).toBe(backend.refreshToken);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }

    // A brand-new store instance reads the persisted token back (no 2nd dance).
    const reloaded = await createTokenStore(fakeApi, backend.apiBaseUrl).load();
    expect(reloaded?.access_token).toBe(backend.accessToken);

    // Real MCP initialize -> tools/call against the bearer-gated server.
    const client = new DeckClient({
      baseUrl: backend.apiBaseUrl,
      accessToken,
    });
    const result = await client.callTool("deck_list_presentations", {});
    expect(result.content[0]?.text).toBe("ok");
  });

  it("rejects an MCP call carrying the wrong bearer (401 -> http.401)", async () => {
    const client = new DeckClient({
      baseUrl: backend.apiBaseUrl,
      accessToken: "not-the-token",
    });
    const err = await client
      .callTool("deck_list_presentations", {})
      .catch((e) => e);
    expect(err.code).toBe("http.401");
  });
});
