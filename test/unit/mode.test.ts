import { describe, it, expect, vi } from "vitest";
import { resolveInitialMode, cycleMode, createModeManager } from "../../src/mode";
import type { PermissionMode } from "../../src/types";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("resolveInitialMode", () => {
  it("uses CLI flag when present and valid", () => {
    const mode = resolveInitialMode("auto", [], "off");
    expect(mode).toBe("auto");
  });

  it("uses CLI flag 'dontAsk' when present", () => {
    const mode = resolveInitialMode("dontAsk", [], "off");
    expect(mode).toBe("dontAsk");
  });

  it("falls back to session state when CLI flag is invalid", () => {
    const entries = [
      { customType: "other", data: {} },
      { customType: "auto-mode-state", data: { mode: "auto" } },
    ];
    const mode = resolveInitialMode("invalid", entries as any, "off");
    expect(mode).toBe("auto");
  });

  it("falls back to settings default when no session state", () => {
    const mode = resolveInitialMode(undefined, [], "dontAsk");
    expect(mode).toBe("dontAsk");
  });

  it("defaults to off when nothing is present", () => {
    const mode = resolveInitialMode(undefined, [], "off");
    expect(mode).toBe("off");
  });

  it("uses the most recent session entry", () => {
    const entries = [
      { customType: "auto-mode-state", data: { mode: "auto" } },
      { customType: "other", data: {} },
      { customType: "auto-mode-state", data: { mode: "dontAsk" } },
    ];
    const mode = resolveInitialMode(undefined, entries as any, "off");
    expect(mode).toBe("dontAsk");
  });

  it("ignores malformed session entries", () => {
    const entries = [
      { customType: "auto-mode-state", data: { mode: "bad-mode" } },
    ];
    const mode = resolveInitialMode(undefined, entries as any, "off");
    expect(mode).toBe("off");
  });
});

describe("cycleMode", () => {
  it("cycles off -> auto -> dontAsk -> off", () => {
    expect(cycleMode("off")).toBe("auto");
    expect(cycleMode("auto")).toBe("dontAsk");
    expect(cycleMode("dontAsk")).toBe("off");
  });
});

describe("createModeManager", () => {
  function makeMockPi(flagValue?: string): ExtensionAPI {
    return {
      registerFlag: vi.fn(),
      getFlag: vi.fn().mockReturnValue(flagValue),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;
  }

  function makeMockCtx(modeEntries: unknown[] = []): ExtensionContext {
    const entries = modeEntries.map((data) => ({
      type: "custom",
      customType: "auto-mode-state",
      data,
    }));
    return {
      ui: {
        setStatus: vi.fn(),
      },
      sessionManager: {
        getEntries: vi.fn().mockReturnValue(entries),
        getBranch: vi.fn().mockReturnValue(entries),
      } as any,
    } as unknown as ExtensionContext;
  }

  it("registers flag, command, and shortcut on setup", () => {
    const pi = makeMockPi();
    const manager = createModeManager(pi, "off");
    manager.setup();

    expect(pi.registerFlag).toHaveBeenCalledWith("auto-mode", {
      description: "Set auto mode (off, auto, dontAsk)",
      type: "string",
      default: undefined,
    });
    expect(pi.registerCommand).toHaveBeenCalledWith("auto-mode", expect.any(Object));
    expect(pi.registerShortcut).toHaveBeenCalledWith("ctrl+shift+a", expect.any(Object));
  });

  it("initializes mode from fallback chain on session_start", () => {
    const pi = makeMockPi("auto");
    const manager = createModeManager(pi, "off");
    manager.setup();

    const ctx = makeMockCtx([]);
    const onCalls = (pi.on as ReturnType<typeof vi.fn>).mock.calls as [string, Function][];
    const sessionStartHandler = onCalls.find((c) => c[0] === "session_start")![1];
    sessionStartHandler({}, ctx);

    expect(manager.getMode()).toBe("auto");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("auto-mode", "auto-mode: auto");
  });

  it("forces mode to off in non-interactive mode without explicit flag", () => {
    const pi = makeMockPi(); // no flag
    const manager = createModeManager(pi, "auto");
    manager.setup();

    const ctx = makeMockCtx([]);
    (ctx as any).hasUI = false;

    const onCalls = (pi.on as ReturnType<typeof vi.fn>).mock.calls as [string, Function][];
    const sessionStartHandler = onCalls.find((c) => c[0] === "session_start")![1];
    sessionStartHandler({}, ctx);

    expect(manager.getMode()).toBe("off");
  });

  it("restores mode from active branch and ignores later abandoned branch state", () => {
    const pi = makeMockPi();
    const manager = createModeManager(pi, "off");
    manager.setup();

    const ctx = makeMockCtx([]);
    (ctx as any).hasUI = true;
    (ctx.sessionManager as any).getEntries = vi.fn().mockReturnValue([
      { type: "custom", customType: "auto-mode-state", data: { mode: "auto" } },
      { type: "custom", customType: "auto-mode-state", data: { mode: "dontAsk" } },
    ]);
    (ctx.sessionManager as any).getBranch = vi.fn().mockReturnValue([
      { type: "custom", customType: "auto-mode-state", data: { mode: "auto" } },
    ]);

    const onCalls = (pi.on as ReturnType<typeof vi.fn>).mock.calls as [string, Function][];
    const sessionStartHandler = onCalls.find((c) => c[0] === "session_start")![1];
    sessionStartHandler({}, ctx);

    expect(manager.getMode()).toBe("auto");
  });

  it("falls back to settings default when only an abandoned branch has auto-mode state", () => {
    const pi = makeMockPi();
    const manager = createModeManager(pi, "dontAsk");
    manager.setup();

    const ctx = makeMockCtx([]);
    (ctx as any).hasUI = true;
    (ctx.sessionManager as any).getEntries = vi.fn().mockReturnValue([
      { type: "custom", customType: "auto-mode-state", data: { mode: "auto" } },
    ]);
    (ctx.sessionManager as any).getBranch = vi.fn().mockReturnValue([]);

    const onCalls = (pi.on as ReturnType<typeof vi.fn>).mock.calls as [string, Function][];
    const sessionStartHandler = onCalls.find((c) => c[0] === "session_start")![1];
    sessionStartHandler({}, ctx);

    expect(manager.getMode()).toBe("dontAsk");
  });

  it("persists mode change via appendEntry and updates footer", () => {
    const pi = makeMockPi();
    const manager = createModeManager(pi, "off");
    manager.setup();

    const ctx = makeMockCtx([]);
    const onCalls = (pi.on as ReturnType<typeof vi.fn>).mock.calls as [string, Function][];
    const sessionStartHandler = onCalls.find((c) => c[0] === "session_start")![1];
    sessionStartHandler({}, ctx);

    manager.setMode("auto", ctx);
    expect(manager.getMode()).toBe("auto");
    expect(pi.appendEntry).toHaveBeenCalledWith("auto-mode-state", { mode: "auto" });
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("auto-mode", "auto-mode: auto");
  });

  it("cycles mode on command or shortcut invocation", () => {
    const pi = makeMockPi();
    const manager = createModeManager(pi, "off");
    manager.setup();

    const ctx = makeMockCtx([]);
    const onCalls = (pi.on as ReturnType<typeof vi.fn>).mock.calls as [string, Function][];
    const sessionStartHandler = onCalls.find((c) => c[0] === "session_start")![1];
    sessionStartHandler({}, ctx);

    // Simulate command handler
    const registerCommandCall = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const commandHandler = registerCommandCall[1].handler;
    commandHandler("", ctx);
    expect(manager.getMode()).toBe("auto");

    // Simulate shortcut handler
    const registerShortcutCall = (pi.registerShortcut as ReturnType<typeof vi.fn>).mock.calls[0];
    const shortcutHandler = registerShortcutCall[1].handler;
    shortcutHandler(ctx);
    expect(manager.getMode()).toBe("dontAsk");
  });
});
