import { describe, it, expect, vi } from "vitest";
import { createDenyContinueManager } from "./deny-continue";
import type { ResolvedConfig } from "./types";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function makeConfig(overrides?: Partial<ResolvedConfig["denyAndContinue"]>): ResolvedConfig {
  return {
    defaultMode: "auto",
    classifier: {
      model: null,
      prompt: null,
      environment: [],
      hardDeny: [],
      softDeny: [],
      allow: [],
      timeoutMs: 3000,
    },
    denyAndContinue: {
      maxConsecutiveDenials: 3,
      maxTotalDenials: 20,
      ...overrides,
    },
  };
}

function makeCtx(hasUI = true): ExtensionContext {
  return {
    ui: {
      notify: vi.fn(),
      confirm: vi.fn(),
    },
    hasUI,
    shutdown: vi.fn(),
  } as unknown as ExtensionContext;
}

describe("createDenyContinueManager", () => {
  it("builds a rich denial message with reason and retry guidance", () => {
    const manager = createDenyContinueManager(makeConfig());
    const msg = manager.buildDenialMessage("Too dangerous");
    expect(msg).toContain("Too dangerous");
    expect(msg).toContain("permission gate");
    expect(msg).toContain("safer approach");
  });

  it("tracks blocked tool calls by ID", () => {
    const manager = createDenyContinueManager(makeConfig());
    manager.recordBlock("tc-1", "Bad command");
    expect(manager.isBlocked("tc-1")).toBe(true);
    expect(manager.getReason("tc-1")).toBe("Bad command");
  });

  it("increments consecutive and total on block", () => {
    const manager = createDenyContinueManager(makeConfig());
    manager.recordBlock("tc-1", "A");
    expect(manager.getConsecutiveDenials()).toBe(1);
    expect(manager.getTotalDenials()).toBe(1);
    manager.recordBlock("tc-2", "B");
    expect(manager.getConsecutiveDenials()).toBe(2);
    expect(manager.getTotalDenials()).toBe(2);
  });

  it("resets consecutive on allow", () => {
    const manager = createDenyContinueManager(makeConfig());
    manager.recordBlock("tc-1", "A");
    manager.recordBlock("tc-2", "B");
    expect(manager.getConsecutiveDenials()).toBe(2);
    manager.recordAllow();
    expect(manager.getConsecutiveDenials()).toBe(0);
    expect(manager.getTotalDenials()).toBe(2); // total does not reset
  });

  it("detects consecutive threshold breach", () => {
    const manager = createDenyContinueManager(makeConfig({ maxConsecutiveDenials: 2 }));
    manager.recordBlock("tc-1", "A");
    expect(manager.isThresholdBreached()).toBe(false);
    manager.recordBlock("tc-2", "B");
    expect(manager.isThresholdBreached()).toBe(true);
  });

  it("detects total threshold breach", () => {
    const manager = createDenyContinueManager(makeConfig({ maxTotalDenials: 2 }));
    manager.recordBlock("tc-1", "A");
    expect(manager.isThresholdBreached()).toBe(false);
    manager.recordAllow(); // reset consecutive
    manager.recordBlock("tc-2", "B");
    expect(manager.isThresholdBreached()).toBe(true);
  });

  it("resets all counters on new session", () => {
    const manager = createDenyContinueManager(makeConfig());
    manager.recordBlock("tc-1", "A");
    manager.recordBlock("tc-2", "B");
    manager.reset();
    expect(manager.getConsecutiveDenials()).toBe(0);
    expect(manager.getTotalDenials()).toBe(0);
    expect(manager.isBlocked("tc-1")).toBe(false);
  });

  it("clears tracking when consuming a blocked result", () => {
    const manager = createDenyContinueManager(makeConfig());
    manager.recordBlock("tc-1", "A");
    expect(manager.isBlocked("tc-1")).toBe(true);
    manager.consumeBlocked("tc-1");
    expect(manager.isBlocked("tc-1")).toBe(false);
  });
});

describe("threshold escalation", () => {
  it("prompts user in interactive mode when threshold is breached", async () => {
    const manager = createDenyContinueManager(makeConfig({ maxConsecutiveDenials: 1 }));
    const ctx = makeCtx(true);
    ctx.ui.confirm = vi.fn().mockResolvedValue(true);

    manager.recordBlock("tc-1", "A");
    const shouldEscalate = manager.isThresholdBreached();
    expect(shouldEscalate).toBe(true);

    const confirmed = await ctx.ui.confirm("Auto-mode threshold reached", "Allow this action?");
    expect(confirmed).toBe(true);
  });

  it("terminates in non-interactive mode when threshold is breached", () => {
    const manager = createDenyContinueManager(makeConfig({ maxConsecutiveDenials: 1 }));
    const ctx = makeCtx(false);

    manager.recordBlock("tc-1", "A");
    expect(manager.isThresholdBreached()).toBe(true);

    // Simulate the shutdown that index.ts would trigger
    ctx.shutdown();
    expect(ctx.shutdown).toHaveBeenCalled();
  });
});
