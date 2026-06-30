#!/usr/bin/env node
// Fail (exit 1) unless the version is identical across every release anchor:
//
//   package.json  ===  src/config.ts PLUGIN_VERSION  ===  a literal baked into
//   the built dist/index.js  ===  the generated openclaw.plugin.json manifest.
//
// This is the guard that would have caught the broken 0.3.0 release, which
// shipped a STALE dist bundle (PLUGIN_VERSION "0.2.1" compiled in) under a
// "0.3.0" package.json plus a drifted "0.2.1" manifest. Checking that the built
// bundle CONTAINS the package version proves the build is fresh — a stale bundle
// bakes the old version string and fails here.
//
// Run AFTER `pnpm build`. npm's `prepublishOnly` runs it automatically; ClawHub's
// `clawhub package publish` packs the working tree and runs NO lifecycle scripts,
// so run `pnpm run check-version` by hand before publishing to ClawHub.
import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`check-version-sync: ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const expected = pkg.version;
if (typeof expected !== "string" || expected.length === 0) {
  fail("package.json has no version");
}

// 1. src/config.ts PLUGIN_VERSION (hand-maintained; sent in the MCP handshake)
const config = readFileSync("src/config.ts", "utf8");
const configMatch = /PLUGIN_VERSION\s*=\s*["']([^"']+)["']/.exec(config);
if (!configMatch) fail("could not find PLUGIN_VERSION in src/config.ts");
if (configMatch[1] !== expected) {
  fail(
    `src/config.ts PLUGIN_VERSION is "${configMatch[1]}", expected "${expected}" ` +
      `(bump it in lockstep with package.json)`,
  );
}

// 2. dist/index.js must contain the version literal — proves the bundle is fresh.
//    PLUGIN_VERSION is compiled into the bundle, so a stale build bakes the OLD
//    version and this check fails (exactly the 0.3.0 failure mode).
let dist;
try {
  dist = readFileSync("dist/index.js", "utf8");
} catch {
  fail("dist/index.js not found — run `pnpm build` first");
}
if (!dist.includes(expected)) {
  fail(
    `dist/index.js does not contain the version literal "${expected}" — the ` +
      `bundle is STALE. Run \`pnpm build\` before publishing.`,
  );
}

// 3. generated openclaw.plugin.json manifest (built from package.json by
//    `openclaw plugins build`; gitignored, so it must be present post-build).
let manifest;
try {
  manifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));
} catch {
  fail("openclaw.plugin.json not found — run `pnpm build` first");
}
if (manifest.version !== expected) {
  fail(
    `openclaw.plugin.json version is "${manifest.version}", expected "${expected}"`,
  );
}

console.log(`check-version-sync: OK — all anchors at ${expected}`);
