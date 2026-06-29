import { describe, expect, it } from "vitest";

import { openBrowser, resolveOpenCommand } from "../browser-open.js";

const URL_STR = "https://api.brightdeck.ai/oauth/authorize?x=1";

describe("resolveOpenCommand", () => {
  it("macOS → ['open', url]", () => {
    expect(resolveOpenCommand(URL_STR, {}, "darwin")).toEqual({
      argv: ["open", URL_STR],
    });
  });

  it("linux with DISPLAY → ['xdg-open', url]", () => {
    expect(resolveOpenCommand(URL_STR, { DISPLAY: ":0" }, "linux")).toEqual({
      argv: ["xdg-open", URL_STR],
    });
  });

  it("linux with WAYLAND_DISPLAY → ['xdg-open', url]", () => {
    expect(
      resolveOpenCommand(URL_STR, { WAYLAND_DISPLAY: "wayland-0" }, "linux"),
    ).toEqual({ argv: ["xdg-open", URL_STR] });
  });

  it("linux without a display and not WSL → refuse 'no-display'", () => {
    expect(resolveOpenCommand(URL_STR, {}, "linux")).toEqual({
      refuse: true,
      reason: "no-display",
    });
  });

  it("WSL (no display) → ['wslview', url]", () => {
    expect(
      resolveOpenCommand(URL_STR, { WSL_DISTRO_NAME: "Ubuntu" }, "linux"),
    ).toEqual({ argv: ["wslview", URL_STR] });
    expect(
      resolveOpenCommand(URL_STR, { WSL_INTEROP: "/run/x" }, "linux"),
    ).toEqual({ argv: ["wslview", URL_STR] });
  });

  it("win32 → rundll32 FileProtocolHandler with the URL appended", () => {
    const decision = resolveOpenCommand(
      URL_STR,
      { SystemRoot: "C:\\Windows" },
      "win32",
    );
    expect("argv" in decision && decision.argv).toEqual([
      "C:\\Windows\\System32\\rundll32.exe",
      "url.dll,FileProtocolHandler",
      URL_STR,
    ]);
  });

  it("win32 defaults SystemRoot when unset", () => {
    const decision = resolveOpenCommand(URL_STR, {}, "win32");
    expect("argv" in decision && decision.argv?.[0]).toBe(
      "C:\\Windows\\System32\\rundll32.exe",
    );
  });

  it("SSH without a display → refuse 'ssh-no-display'", () => {
    for (const key of ["SSH_CLIENT", "SSH_TTY", "SSH_CONNECTION"]) {
      expect(resolveOpenCommand(URL_STR, { [key]: "1" }, "linux")).toEqual({
        refuse: true,
        reason: "ssh-no-display",
      });
    }
  });

  it("SSH WITH a display still opens (xdg-open)", () => {
    expect(
      resolveOpenCommand(URL_STR, { SSH_TTY: "1", DISPLAY: ":0" }, "linux"),
    ).toEqual({ argv: ["xdg-open", URL_STR] });
  });

  it("CI → refuse 'ci' (takes precedence over a usable platform)", () => {
    expect(resolveOpenCommand(URL_STR, { CI: "true" }, "darwin")).toEqual({
      refuse: true,
      reason: "ci",
    });
  });

  it("DECK_NO_BROWSER → refuse 'opt-out'", () => {
    expect(
      resolveOpenCommand(URL_STR, { DECK_NO_BROWSER: "1" }, "darwin"),
    ).toEqual({ refuse: true, reason: "opt-out" });
  });

  it("an unsupported platform → refuse 'unsupported-platform'", () => {
    expect(resolveOpenCommand(URL_STR, {}, "freebsd")).toEqual({
      refuse: true,
      reason: "unsupported-platform",
    });
  });
});

describe("openBrowser", () => {
  it("short-circuits to false under VITEST (never spawns)", async () => {
    await expect(openBrowser(URL_STR, { VITEST: "1" })).resolves.toBe(false);
  });

  it("returns false for a non-http(s) URL (no spawn)", async () => {
    // Empty env (no VITEST) so we exercise the protocol guard, not the
    // test short-circuit; a `file:` URL must never spawn an opener.
    await expect(openBrowser("file:///etc/passwd", {})).resolves.toBe(false);
  });

  it("returns false for a malformed URL (no spawn)", async () => {
    await expect(openBrowser("not-a-valid-url", {})).resolves.toBe(false);
  });
});
