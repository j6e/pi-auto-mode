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

function makeDeps(projectDir: string, homeDir: string) {
  let config: ResolvedConfig = loadConfig(projectDir, homeDir, { includeProject: false });
  return {
    deps: {
      getConfig: () => config,
      reloadConfig: vi.fn((cwd?: string, includeProject = false) => {
        config = loadConfig(cwd ?? projectDir, homeDir, { includeProject });
        return config;
      }),
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
    expect(deps.reloadConfig).toHaveBeenCalledWith(projectDir, false);
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

    expect(deps.reloadConfig).toHaveBeenCalledWith(projectDir, true);
    expect(getConfig().defaultMode).toBe("auto");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Updated defaultMode", "info");
  });
});
