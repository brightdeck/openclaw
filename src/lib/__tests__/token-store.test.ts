import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OAuthResult } from "../oauth.js";
import { createFileTokenStore } from "../token-store.js";

// `node:os` homedir is mocked so the "no home dir" case is deterministic
// regardless of the machine running the suite. Every other test pins
// OPENCLAW_STATE_DIR, which short-circuits the homedir lookup entirely.
const osHolder = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => osHolder.home };
});

const API = "https://api.brightdeck.ai";

const TOKEN: OAuthResult = {
  access_token: "at-1",
  refresh_token: "rt-1",
  expires_in: 600,
  scope: "presentation:read presentation:write",
  obtained_at: 1_700_000_000,
};

/** The path the production store writes to under a given state dir. */
function tokenFile(stateDir: string): string {
  return join(stateDir, "plugin-state", "openclaw-deck", "oauth.json");
}

const ENV_KEYS = [
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_HOME",
  "HOME",
  "USERPROFILE",
] as const;

describe("createFileTokenStore", () => {
  let tmp: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    tmp = mkdtempSync(join(tmpdir(), "ocd-store-"));
    process.env.OPENCLAW_STATE_DIR = tmp;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("round-trips the exact OAuthResult through save -> load", async () => {
    const store = createFileTokenStore(API);
    await store.save(TOKEN);
    const loaded = await store.load();
    expect(loaded).toEqual(TOKEN);
  });

  it.runIf(process.platform !== "win32")(
    "creates the token file with 0600 permissions",
    async () => {
      const store = createFileTokenStore(API);
      await store.save(TOKEN);
      const mode = statSync(tokenFile(tmp)).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it("persists v:1 + the scoping apiBaseUrl in the blob", async () => {
    const store = createFileTokenStore(API);
    await store.save(TOKEN);
    const blob = JSON.parse(readFileSync(tokenFile(tmp), "utf8"));
    expect(blob.v).toBe(1);
    expect(blob.apiBaseUrl).toBe(API);
    expect(blob.token.access_token).toBe("at-1");
  });

  it("returns null when the token was minted for another backend", async () => {
    await createFileTokenStore(API).save(TOKEN);
    const other = createFileTokenStore("https://deck.example.com");
    expect(await other.load()).toBeNull();
  });

  it("returns null for an unknown blob version", async () => {
    const file = tokenFile(tmp);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ v: 2, apiBaseUrl: API, token: TOKEN }));
    expect(await createFileTokenStore(API).load()).toBeNull();
  });

  it("returns null and removes the file on corrupt JSON", async () => {
    const file = tokenFile(tmp);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "{ not valid json");
    const store = createFileTokenStore(API);
    expect(await store.load()).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it("returns null when no token file exists", async () => {
    expect(await createFileTokenStore(API).load()).toBeNull();
  });

  it("clear() removes the persisted file", async () => {
    const store = createFileTokenStore(API);
    await store.save(TOKEN);
    expect(existsSync(tokenFile(tmp))).toBe(true);
    await store.clear();
    expect(existsSync(tokenFile(tmp))).toBe(false);
  });

  it("leaves no *.tmp.* file behind after an atomic save", async () => {
    const store = createFileTokenStore(API);
    await store.save(TOKEN);
    const dir = join(tmp, "plugin-state", "openclaw-deck");
    const entries = readdirSync(dir);
    expect(entries).toEqual(["oauth.json"]);
    expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
  });

  it("degrades to an in-memory store (warn, no cwd write) when no home resolves", async () => {
    delete process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_HOME = "";
    process.env.HOME = "";
    process.env.USERPROFILE = "";
    osHolder.home = "";

    const onWarn = vi.fn();
    const store = createFileTokenStore(API, onWarn);
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]?.[0]).toMatch(/no resolvable home dir/);

    // Still functional in-memory…
    await store.save(TOKEN);
    expect(await store.load()).toEqual(TOKEN);

    // …but it must NOT have written a plugin-state tree under the cwd.
    expect(existsSync(join(process.cwd(), "plugin-state"))).toBe(false);
  });

  it("swallows + warns when the target dir is unwritable; never throws", async () => {
    // Point the state dir at a regular file so mkdir of the subtree ENOTDIRs.
    const asFile = join(tmp, "not-a-dir");
    writeFileSync(asFile, "x");
    process.env.OPENCLAW_STATE_DIR = asFile;

    const onWarn = vi.fn();
    const store = createFileTokenStore(API, onWarn);
    await expect(store.save(TOKEN)).resolves.toBeUndefined();
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]?.[0]).toMatch(/failed to persist token/);
    // load() on the same broken path degrades to null, not a throw.
    await expect(store.load()).resolves.toBeNull();
  });
});
