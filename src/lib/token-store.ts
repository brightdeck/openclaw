import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import type { OAuthResult } from "./oauth.js";
import { resolveStateDir } from "./state-dir.js";

/**
 * Minimal token-store surface the auth resolver consumes. Concrete impls
 * back this with a plaintext `0600` JSON file under the OpenClaw home
 * (production) or an in-memory map (tests / degraded fallback).
 */
export interface TokenStore {
  load(): Promise<OAuthResult | null>;
  save(value: OAuthResult): Promise<void>;
  clear(): Promise<void>;
}

const DIR_MODE = 0o700; // matches the SDK plugin-state dir mode
const FILE_MODE = 0o600; // matches the SDK plugin-state file mode
const BLOB_VERSION = 1;

interface StoredBlob {
  v: number;
  apiBaseUrl: string;
  token: OAuthResult;
}

function tokenPath(env = process.env): string | undefined {
  const stateDir = resolveStateDir(env);
  if (!stateDir) return undefined;
  return join(stateDir, "plugin-state", "openclaw-deck", "oauth.json");
}

/**
 * File-backed token store. Tokens are persisted as plaintext JSON at `0600`
 * under `<OpenClaw home>/.openclaw/plugin-state/openclaw-deck/oauth.json` —
 * the same posture as `gh`/`aws cli` and the SDK's own (plaintext, perms-only)
 * plugin-state store. The blob is scoped by `apiBaseUrl` so a token minted for
 * one backend is never replayed against another.
 *
 * Degrades to an in-memory store (with a one-line warning) when no home dir
 * resolves or the filesystem is unwritable — it NEVER throws out of a tool
 * call, and it NEVER writes under the process cwd.
 */
export function createFileTokenStore(
  apiBaseUrl: string,
  onWarn?: (message: string) => void,
): TokenStore {
  const file = tokenPath();
  if (!file) {
    onWarn?.(
      "openclaw-deck: no resolvable home dir; tokens will not persist across runs",
    );
    return createMemoryTokenStore();
  }
  return {
    async load() {
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch {
        return null; // missing == no token
      }
      try {
        const blob = JSON.parse(raw) as StoredBlob;
        if (blob.v !== BLOB_VERSION) return null;
        if (blob.apiBaseUrl !== apiBaseUrl) return null; // minted for another backend
        const t = blob.token;
        if (
          !t ||
          typeof t.access_token !== "string" ||
          typeof t.refresh_token !== "string"
        ) {
          return null;
        }
        return t;
      } catch {
        // Corrupt/partial file — drop it so the next run starts clean.
        try {
          rmSync(file, { force: true });
        } catch {
          /* ignore */
        }
        return null;
      }
    },
    async save(value) {
      const blob: StoredBlob = { v: BLOB_VERSION, apiBaseUrl, token: value };
      try {
        mkdirSync(join(file, ".."), { recursive: true, mode: DIR_MODE });
        const tmp = `${file}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
        writeFileSync(tmp, JSON.stringify(blob), { mode: FILE_MODE });
        chmodSync(tmp, FILE_MODE); // umask-proof
        renameSync(tmp, file); // atomic on POSIX
      } catch (err) {
        onWarn?.(
          `openclaw-deck: failed to persist token (${(err as Error).message}); will re-auth next run`,
        );
      }
    },
    async clear() {
      try {
        rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Production entry point — keeps the original name; now file-backed. Warnings
 * are routed to the plugin's structured logger.
 */
export function createTokenStore(
  api: OpenClawPluginApi,
  apiBaseUrl: string,
): TokenStore {
  return createFileTokenStore(apiBaseUrl, (msg) => api.logger.warn(msg));
}

/** In-memory store useful for tests and as a fallback when no home resolves. */
export function createMemoryTokenStore(seed?: OAuthResult | null): TokenStore {
  let current: OAuthResult | null = seed ?? null;
  return {
    async load() {
      return current;
    },
    async save(value) {
      current = value;
    },
    async clear() {
      current = null;
    },
  };
}
