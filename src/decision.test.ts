import { describe, it, expect, vi } from "vitest";
import { makeDecision } from "./decision";
import type { PermissionMode } from "./types";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function makeCtx(): ExtensionContext {
  return {
    ui: { notify: vi.fn() },
    cwd: "/home/user/project",
    hasUI: true,
  } as unknown as ExtensionContext;
}

describe("makeDecision", () => {
  it("allows Tier 1 tools in all modes", async () => {
    for (const mode of ["off", "auto", "dontAsk"] as PermissionMode[]) {
      const result = await makeDecision(mode, "read", { path: "file.ts" }, makeCtx());
      expect(result).toEqual({ allow: true });
    }
  });

  it("allows Tier 2 in auto mode for in-project paths", async () => {
    const result = await makeDecision("auto", "write", { path: "/home/user/project/src/foo.ts" }, makeCtx());
    expect(result).toEqual({ allow: true });
  });

  it("blocks protected paths in all modes", async () => {
    for (const mode of ["off", "auto", "dontAsk"] as PermissionMode[]) {
      const ctx = makeCtx();
      const result = await makeDecision(mode, "write", { path: ".env" }, ctx);
      expect(result).toEqual({ block: true, reason: expect.stringContaining("protected") });
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Blocked"), "warning");
    }
  });

  it("in auto mode, non-tiered tools block via classifier placeholder", async () => {
    const result = await makeDecision("auto", "bash", { command: "npm test" }, makeCtx());
    expect(result).toEqual({ block: true, reason: expect.stringContaining("classifier") });
  });

  it("in dontAsk mode, non-tiered tools are denied", async () => {
    const result = await makeDecision("dontAsk", "bash", { command: "npm test" }, makeCtx());
    expect(result).toEqual({ block: true, reason: expect.stringContaining("dontAsk") });
  });

  it("in off mode, non-tiered tools are allowed through (extension inactive)", async () => {
    const result = await makeDecision("off", "bash", { command: "npm test" }, makeCtx());
    expect(result).toEqual({ allow: true });
  });
});
