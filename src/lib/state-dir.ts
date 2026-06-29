import { homedir } from "node:os";
import { join } from "node:path";

/** Treat "", "undefined", "null" as empty (mirrors the SDK's env normalize). */
function normalizeEnv(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "undefined" || trimmed === "null") {
    return undefined;
  }
  return trimmed;
}

/**
 * Home dir with the SAME precedence as the OpenClaw runtime, minus the
 * runtime's unsafe `process.cwd()` fallback. Returns undefined when no real
 * home resolves (callers MUST NOT write under cwd in that case).
 *
 * Precedence: OPENCLAW_HOME -> HOME -> USERPROFILE -> os.homedir()
 */
export function resolveHomeDir(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv =
    normalizeEnv(env.OPENCLAW_HOME) ??
    normalizeEnv(env.HOME) ??
    normalizeEnv(env.USERPROFILE);
  if (fromEnv) return fromEnv;
  return normalizeEnv(homedir());
}

/**
 * OpenClaw state dir: OPENCLAW_STATE_DIR override, else `<home>/.openclaw`.
 * Returns undefined if no home resolves. The ".openclaw" segment is a
 * constant, assembled with `join` from a real home path — never a
 * tilde-prefixed literal (which the public-mirror audit forbids).
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const override = normalizeEnv(env.OPENCLAW_STATE_DIR);
  if (override) return override;
  const home = resolveHomeDir(env);
  return home ? join(home, ".openclaw") : undefined;
}
