import { describe, it, expect, vi } from "vitest";
import { makeDecision } from "./decision";
import type { PermissionMode, ResolvedConfig } from "./types";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("@earendil-works/pi-ai", () => ({
  complete: vi.fn().mockRejectedValue(new Error("Mock classifier failure")),
}));

const DEFAULT_CONFIG: ResolvedConfig = {
  defaultMode: "auto",
  classifier: {
    model: null,
    prompt: null,
    environment: ["Dev env"],
    hardDeny: ["No rm -rf"],
    softDeny: ["Be careful"],
    allow: ["Tests are fine"],
  },
  denyAndContinue: {
    maxConsecutiveDenials: 3,
    maxTotalDenials: 20,
  },
};

function makeCtx(): ExtensionContext {
  return {
    ui: { notify: vi.fn() },
    cwd: "/home/user/project",
    hasUI: true,
    model: { id: "claude", provider: "anthropic" },
    modelRegistry: { find: vi.fn() },
  } as unknown as ExtensionContext;
}

describe("makeDecision", () => {
  it("allows Tier 1 tools in all modes", async () => {
    for (const mode of ["off", "auto", "dontAsk"] as PermissionMode[]) {
      const result = await makeDecision(mode, "read", { path: "file.ts" }, makeCtx(), DEFAULT_CONFIG, []);
      expect(result).toEqual({ allow: true });
    }
  });

  it("allows Tier 2 in auto mode for in-project paths", async () => {
    const result = await makeDecision("auto", "write", { path: "/home/user/project/src/foo.ts" }, makeCtx(), DEFAULT_CONFIG, []);
    expect(result).toEqual({ allow: true });
  });

  it("blocks protected paths in all modes", async () => {
    for (const mode of ["off", "auto", "dontAsk"] as PermissionMode[]) {
      const ctx = makeCtx();
      const result = await makeDecision(mode, "write", { path: ".env" }, ctx, DEFAULT_CONFIG, []);
      expect(result).toEqual({ block: true, reason: expect.stringContaining("protected") });
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Blocked"), "warning");
    }
  });

  it("in auto mode, non-tiered tools route to classifier and block on failure in non-interactive mode", async () => {
    const ctx = makeCtx();
    ctx.hasUI = false;
    const result = await makeDecision("auto", "bash", { command: "npm test" }, ctx, DEFAULT_CONFIG, []);
    expect(result).toEqual({ block: true, reason: expect.stringContaining("Mock classifier failure") });
  });

  it("in auto mode, classifier failure falls back to confirm in interactive mode", async () => {
    const ctx = makeCtx();
    ctx.ui.confirm = vi.fn().mockResolvedValue(true);
    const result = await makeDecision("auto", "bash", { command: "npm test" }, ctx, DEFAULT_CONFIG, []);
    expect(result).toEqual({ allow: true });
    expect(ctx.ui.confirm).toHaveBeenCalled();
  });

  it("in auto mode, classifier failure blocks if user declines confirm", async () => {
    const ctx = makeCtx();
    ctx.ui.confirm = vi.fn().mockResolvedValue(false);
    const result = await makeDecision("auto", "bash", { command: "npm test" }, ctx, DEFAULT_CONFIG, []);
    expect(result).toEqual({ block: true, reason: expect.stringContaining("Mock classifier failure") });
  });

  it("in dontAsk mode, non-tiered tools are denied", async () => {
    const result = await makeDecision("dontAsk", "bash", { command: "npm test" }, makeCtx(), DEFAULT_CONFIG, []);
    expect(result).toEqual({ block: true, reason: expect.stringContaining("dontAsk") });
  });

  it("in off mode, non-tiered tools are allowed through (extension inactive)", async () => {
    const result = await makeDecision("off", "bash", { command: "npm test" }, makeCtx(), DEFAULT_CONFIG, []);
    expect(result).toEqual({ allow: true });
  });
});
