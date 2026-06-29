import { runCommandWithTimeout } from "openclaw/plugin-sdk/process-runtime";

/**
 * Self-contained browser opener. The SDK ships an equivalent `openUrl`, but it
 * is not on a public export subpath, so we replicate the ~15 lines here.
 *
 * The decision (which per-OS command to run, or whether to refuse) is split out
 * as a pure, unit-testable function. The headless/SSH/CI guards mirror the SDK's
 * own logic, plus a `CI` short-circuit and a `DECK_NO_BROWSER` opt-out the SDK
 * lacks. `BROWSER` is deliberately NOT read — the SDK treats it as an injection
 * hazard.
 */

type OpenDecision = { argv: string[] } | { refuse: true; reason: string };

/** Pure: decide the per-OS argv (URL appended) or refuse. Unit-testable. */
export function resolveOpenCommand(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): OpenDecision {
  if (env.CI) return { refuse: true, reason: "ci" };
  if (env.DECK_NO_BROWSER) return { refuse: true, reason: "opt-out" };
  const hasDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  const isSsh = Boolean(env.SSH_CLIENT || env.SSH_TTY || env.SSH_CONNECTION);
  if (isSsh && !hasDisplay && platform !== "win32") {
    return { refuse: true, reason: "ssh-no-display" };
  }
  if (platform === "darwin") return { argv: ["open", url] };
  if (platform === "win32") {
    const root = env.SystemRoot ?? "C:\\Windows";
    return {
      argv: [`${root}\\System32\\rundll32.exe`, "url.dll,FileProtocolHandler", url],
    };
  }
  if (platform === "linux") {
    const isWsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
    if (!hasDisplay && !isWsl) return { refuse: true, reason: "no-display" };
    if (isWsl) return { argv: ["wslview", url] };
    return { argv: ["xdg-open", url] };
  }
  return { refuse: true, reason: "unsupported-platform" };
}

/**
 * Best-effort open of `url` in the user's browser. Returns `false` (never
 * throws) when running headless / refused / the spawn fails — callers always
 * print the URL too, so a `false` here is non-fatal. Short-circuits under
 * `VITEST` so tests never spawn a browser.
 */
export async function openBrowser(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (env.VITEST) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const decision = resolveOpenCommand(parsed.toString(), env);
  if ("refuse" in decision) return false;
  try {
    const res = await runCommandWithTimeout(decision.argv, { timeoutMs: 5000 });
    return res.code === 0;
  } catch {
    return false;
  }
}
