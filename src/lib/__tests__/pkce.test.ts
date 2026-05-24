import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { base64UrlEncode, generatePkce, generateState } from "../pkce.js";

describe("pkce", () => {
  it("generates a verifier and challenge pair that round-trips via S256", () => {
    const pair = generatePkce();
    expect(pair.method).toBe("S256");
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge.length).toBeGreaterThanOrEqual(43);

    const expectedChallenge = base64UrlEncode(
      createHash("sha256").update(pair.verifier).digest(),
    );
    expect(pair.challenge).toBe(expectedChallenge);
  });

  it("never includes padding or url-unsafe characters", () => {
    for (let i = 0; i < 20; i++) {
      const pair = generatePkce();
      expect(pair.verifier).not.toMatch(/[+/=]/);
      expect(pair.challenge).not.toMatch(/[+/=]/);
    }
  });

  it("generates distinct state values per call", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toMatch(/[+/=]/);
  });
});
