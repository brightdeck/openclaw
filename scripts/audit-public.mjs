#!/usr/bin/env node
// Fails (exit 1) if any tracked file matches a forbidden pattern.
// Run before commit and in CI to keep the repo detachment-ready.

import { execSync } from "node:child_process";

const FORBIDDEN = [
  // Monorepo paths
  /(^|[^a-zA-Z0-9])backend\//,
  /(^|[^a-zA-Z0-9])frontend\//,
  /(^|[^a-zA-Z0-9])thoughts\//,
  /(^|[^a-zA-Z0-9])infra\//,
  // Internal hostnames
  /api-staging\.brightdeck\.ai(?![^"]*"\s*\/\/\s*allowed)/,
  /backend-(staging|prod)\.brightdeck\.ai/,
  // Likely-credential shapes
  /sk_(live|test)_[A-Za-z0-9]{16,}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----/,
];

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.startsWith("dist/"))
  .filter((f) => !f.endsWith("audit-public.mjs"));

let bad = 0;
for (const f of files) {
  const text = await import("node:fs/promises").then((m) => m.readFile(f, "utf8")).catch(() => "");
  for (const re of FORBIDDEN) {
    const m = re.exec(text);
    if (m) {
      console.error(`FORBIDDEN match in ${f}: ${m[0]}`);
      bad++;
    }
  }
}
if (bad > 0) {
  console.error(`\n${bad} forbidden pattern hit(s). See public-repo hygiene rules in the plan.`);
  process.exit(1);
}
console.log(`audit-public: OK (${files.length} files scanned)`);
