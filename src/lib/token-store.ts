import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import type { OAuthResult } from "./oauth.js";

/**
 * Minimal token-store surface the auth resolver consumes. Concrete impls
 * back this with the gateway's keyed store (production) or an in-memory map
 * (tests).
 */
export interface TokenStore {
  load(): Promise<OAuthResult | null>;
  save(value: OAuthResult): Promise<void>;
  clear(): Promise<void>;
}

const STORAGE_KEY = "oauth";
const NAMESPACE = "openclaw-deck:oauth";
const MAX_ENTRIES = 4;

/**
 * Open the plugin-owned token store backed by the gateway's keyed-store
 * runtime. The gateway encrypts the underlying SQLite database at rest, so
 * the plugin never persists tokens itself.
 */
export function createTokenStore(api: OpenClawPluginApi): TokenStore {
  const store = api.runtime.state.openKeyedStore<OAuthResult>({
    namespace: NAMESPACE,
    maxEntries: MAX_ENTRIES,
  });
  return {
    async load() {
      const value = await store.lookup(STORAGE_KEY);
      return value ?? null;
    },
    async save(value) {
      // ``register`` overwrites an existing entry, which is what we want for
      // a single-slot token blob.
      await store.delete(STORAGE_KEY);
      await store.register(STORAGE_KEY, value);
    },
    async clear() {
      await store.delete(STORAGE_KEY);
    },
  };
}

/** In-memory store useful for tests and as a fallback when the runtime store fails. */
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
