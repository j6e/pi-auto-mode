import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleAutoModeCommand } from "../../src/config-command";
import { loadConfig } from "../../src/config";
import type { PermissionMode, ResolvedConfig } from "../../src/types";

function makeCtx(cwd: string, trusted: boolean): ExtensionContext {
  return {
    cwd,
    isProjectTrusted: vi.fn().mockReturnValue(trusted),
    ui: {
      notify: vi.fn(),
    },
  } as unknown as ExtensionContext;
}

function makeDeps(projectDir: string, homeDir: string, includeProject = false) {
  let config: ResolvedConfig = loadConfig(projectDir, homeDir, { includeProject });
  function loadForContext(ctx: ExtensionContext) {
    const includesProject = (ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() ?? false;
    config = loadConfig(ctx.cwd ?? projectDir, homeDir, { includeProject: includesProject });
    return { config, includesProject };
  }
  return {
    deps: {
      resolveEffectiveConfig: vi.fn(loadForContext),
      getMode: vi.fn<[], PermissionMode>().mockReturnValue("off"),
      setMode: vi.fn(),
    },
    getConfig: () => config,
  };
}

describe("handleAutoModeCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auto-mode-command-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports untrusted active effective config for status and config get", async () => {
    const homeDir = path.join(tmpDir, "home");
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(homeDir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({ autoMode: { defaultMode: "off" } }),
    );
    fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ autoMode: { defaultMode: "auto" } }),
    );

    const ctx = makeCtx(projectDir, false);
    const { deps } = makeDeps(projectDir, homeDir, false);

    await handleAutoModeCommand("status", ctx, deps);
    await handleAutoModeCommand("config get defaultMode", ctx, deps);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"defaultMode": "off"'), "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith('"off"', "info");
  });

  it("reports trusted active effective config for status and config get", async () => {
    const homeDir = path.join(tmpDir, "home");
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(homeDir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({ autoMode: { defaultMode: "off" } }),
    );
    fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ autoMode: { defaultMode: "auto" } }),
    );

    const ctx = makeCtx(projectDir, true);
    const { deps } = makeDeps(projectDir, homeDir, true);

    await handleAutoModeCommand("status", ctx, deps);
    await handleAutoModeCommand("config get defaultMode", ctx, deps);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"defaultMode": "auto"'), "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith('"auto"', "info");
  });

  it("writes untrusted project config without loading it into the effective config", async () => {
    const homeDir = path.join(tmpDir, "home");
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(homeDir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({ autoMode: { defaultMode: "off" } }),
    );
    fs.mkdirSync(projectDir, { recursive: true });

    const ctx = makeCtx(projectDir, false);
    const { deps, getConfig } = makeDeps(projectDir, homeDir);

    await handleAutoModeCommand("config set defaultMode auto", ctx, deps);

    const projectSettings = JSON.parse(fs.readFileSync(path.join(projectDir, ".pi", "settings.json"), "utf-8"));
    expect(projectSettings.autoMode.defaultMode).toBe("auto");
    expect(deps.resolveEffectiveConfig).toHaveBeenCalledWith(ctx);
    expect(getConfig().defaultMode).toBe("off");
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("not trusted"), "warning");
  });

  it("writes trusted project config and loads it into the effective config", async () => {
    const homeDir = path.join(tmpDir, "home");
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });

    const ctx = makeCtx(projectDir, true);
    const { deps, getConfig } = makeDeps(projectDir, homeDir);

    await handleAutoModeCommand("config set defaultMode auto", ctx, deps);

    expect(deps.resolveEffectiveConfig).toHaveBeenCalledWith(ctx);
    expect(getConfig().defaultMode).toBe("auto");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Updated defaultMode", "info");
  });
});
