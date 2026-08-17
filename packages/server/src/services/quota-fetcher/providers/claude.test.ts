import pino from "pino";
import { describe, expect, it } from "vitest";
import { ClaudeQuotaProvider } from "./claude.js";

const logger = pino({ level: "silent" });

function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: { type: "forbidden" } }), { status: 403 });
}

describe("ClaudeQuotaProvider forbidden handling", () => {
  it("surfaces a 403 as an error state instead of a silent blank card", async () => {
    // Keychain-sourced credentials (filePath null); a 403 must not be treated as a stale
    // token and must not blank out silently.
    const provider = new ClaudeQuotaProvider({
      logger,
      platform: "darwin",
      claudeHome: "/nonexistent-claude-home",
      claudeKeychainReader: async () => ({
        claudeAiOauth: { accessToken: "t", refreshToken: "r" },
      }),
      fetch: async () => forbiddenResponse(),
    });

    const usage = await provider.fetchUsage();

    expect(usage.status).toBe("error");
    expect(usage.error).toMatch(/organization/i);
    expect(usage.windows).toHaveLength(0);
  });

  it("reports plain unavailable when no credentials exist", async () => {
    const provider = new ClaudeQuotaProvider({
      logger,
      platform: "linux",
      claudeHome: "/nonexistent-claude-home",
      claudeKeychainReader: async () => null,
      fetch: async () => new Response("{}", { status: 200 }),
    });

    const usage = await provider.fetchUsage();

    expect(usage.status).toBe("unavailable");
    expect(usage.error).toBeNull();
  });
});
