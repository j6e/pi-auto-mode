import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfig, loadConfig } from "../../src/config";
import type { AutoModeSettings } from "../../src/types";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("resolveConfig", () => {
  it("returns defaults when no settings provided", () => {
    const config = resolveConfig();
    expect(config.defaultMode).toBe("off");
    expect(config.classifier.model).toBeNull();
    expect(config.classifier.prompt).toBeNull();
    expect(config.classifier.environment.length).toBeGreaterThan(0);
    expect(config.classifier.hardDeny.length).toBeGreaterThan(0);
    expect(config.classifier.softDeny.length).toBeGreaterThan(0);
    expect(config.classifier.allow.length).toBeGreaterThan(0);
    expect(config.classifier.timeoutMs).toBe(3000);
    expect(config.classifier.toolMode).toBe("force");
    expect(config.denyAndContinue.maxConsecutiveDenials).toBe(3);
    expect(config.denyAndContinue.maxTotalDenials).toBe(20);
  });

  it("uses project settings over global settings", () => {
    const globalSettings: AutoModeSettings = {
      defaultMode: "auto",
      classifier: {
        model: "anthropic/claude-sonnet-4",
        prompt: null,
        environment: ["$defaults", "Global env"],
        hardDeny: ["$defaults", "Global hard"],
        softDeny: ["$defaults", "Global soft"],
        allow: ["$defaults", "Global allow"],
        timeoutMs: 5000,
      },
      denyAndContinue: {
        maxConsecutiveDenials: 5,
        maxTotalDenials: 50,
      },
    };

    const projectSettings: AutoModeSettings = {
      defaultMode: "dontAsk",
      classifier: {
        model: "openai/gpt-4o",
        prompt: "custom prompt",
        environment: ["Project env"],
        hardDeny: ["Project hard"],
        softDeny: ["$defaults", "Project soft"],
        allow: ["$defaults"],
        timeoutMs: 2000,
        toolMode: "auto",
      },
      denyAndContinue: {
        maxConsecutiveDenials: 2,
        maxTotalDenials: 10,
      },
    };

    const config = resolveConfig(globalSettings, projectSettings);
    expect(config.defaultMode).toBe("dontAsk");
    expect(config.classifier.model).toBe("openai/gpt-4o");
    expect(config.classifier.prompt).toBe("custom prompt");
    expect(config.classifier.timeoutMs).toBe(2000);
    expect(config.classifier.toolMode).toBe("auto");
    expect(config.denyAndContinue.maxConsecutiveDenials).toBe(2);
    expect(config.denyAndContinue.maxTotalDenials).toBe(10);
  });

  it("expands $defaults tokens by splicing built-in lists", () => {
    const settings: AutoModeSettings = {
      defaultMode: "off",
      classifier: {
        model: null,
        prompt: null,
        environment: ["$defaults", "Custom env"],
        hardDeny: ["Custom hard", "$defaults"],
        softDeny: ["$defaults"],
        allow: ["$defaults", "Custom allow"],
        timeoutMs: 3000,
      },
      denyAndContinue: {
        maxConsecutiveDenials: 3,
        maxTotalDenials: 20,
      },
    };

    const config = resolveConfig(undefined, settings);
    const env = config.classifier.environment;
    const hard = config.classifier.hardDeny;
    const soft = config.classifier.softDeny;
    const allow = config.classifier.allow;

    // $defaults should be replaced with built-in strings, not the literal "$defaults"
    expect(env).not.toContain("$defaults");
    expect(hard).not.toContain("$defaults");
    expect(soft).not.toContain("$defaults");
    expect(allow).not.toContain("$defaults");

    // Custom items should be present
    expect(env).toContain("Custom env");
    expect(hard).toContain("Custom hard");
    expect(allow).toContain("Custom allow");

    // Built-in defaults should be present
    expect(env.length).toBeGreaterThan(1);
    expect(hard.length).toBeGreaterThan(1);
  });

  it("gracefully handles malformed autoMode blocks", () => {
    const malformed = {
      defaultMode: "invalid-mode" as any,
      classifier: {
        model: 123 as any,
        prompt: 456 as any,
        environment: "not-an-array" as any,
        hardDeny: null as any,
        softDeny: undefined as any,
        allow: undefined as any,
        toolMode: "invalid" as any,
      },
      denyAndContinue: {
        maxConsecutiveDenials: "three" as any,
        maxTotalDenials: null as any,
      },
    };

    const config = resolveConfig(undefined, malformed as any);
    expect(config.defaultMode).toBe("off");
    expect(config.classifier.model).toBeNull();
    expect(config.classifier.prompt).toBeNull();
    expect(Array.isArray(config.classifier.environment)).toBe(true);
    expect(Array.isArray(config.classifier.hardDeny)).toBe(true);
    expect(Array.isArray(config.classifier.softDeny)).toBe(true);
    expect(Array.isArray(config.classifier.allow)).toBe(true);
    expect(config.classifier.timeoutMs).toBe(3000);
    expect(config.classifier.toolMode).toBe("force");
    expect(config.denyAndContinue.maxConsecutiveDenials).toBe(3);
    expect(config.denyAndContinue.maxTotalDenials).toBe(20);
  });

  it("partial project settings merge with global defaults", () => {
    const projectSettings: Partial<AutoModeSettings> = {
      defaultMode: "auto",
      classifier: {
        model: "openai/gpt-4o-mini",
        prompt: null,
        environment: [],
        hardDeny: [],
        softDeny: [],
        allow: [],
        timeoutMs: 3000,
      },
    };

    const config = resolveConfig(undefined, projectSettings as AutoModeSettings);
    expect(config.defaultMode).toBe("auto");
    expect(config.classifier.model).toBe("openai/gpt-4o-mini");
    expect(config.classifier.timeoutMs).toBe(3000);
    expect(config.denyAndContinue.maxConsecutiveDenials).toBe(3);
    expect(config.denyAndContinue.maxTotalDenials).toBe(20);
  });
});

describe("loadConfig", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auto-mode-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads project settings from .pi/settings.json when project config is included", () => {
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({
        autoMode: {
          defaultMode: "auto",
          classifier: { model: "openai/gpt-4o" },
        },
      }),
    );

    const config = loadConfig(tmpDir, undefined, { includeProject: true });
    expect(config.defaultMode).toBe("auto");
    expect(config.classifier.model).toBe("openai/gpt-4o");
  });

  it("ignores project settings when project config is not included", () => {
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({
        autoMode: {
          defaultMode: "auto",
          classifier: { model: "openai/gpt-4o" },
        },
      }),
    );

    const config = loadConfig(tmpDir, undefined, { includeProject: false });
    expect(config.defaultMode).toBe("off");
    expect(config.classifier.model).toBeNull();
  });

  it("falls back to defaults when no settings files exist", () => {
    const config = loadConfig(tmpDir, undefined, { includeProject: false });
    expect(config.defaultMode).toBe("off");
    expect(config.classifier.model).toBeNull();
  });

  it("ignores malformed settings files", () => {
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "settings.json"),
      "not valid json",
    );

    const config = loadConfig(tmpDir, undefined, { includeProject: true });
    expect(config.defaultMode).toBe("off");
    expect(config.classifier.model).toBeNull();
  });
});
