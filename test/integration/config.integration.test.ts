import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig } from "../../src/config";

describe("loadConfig integration", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auto-mode-int-"));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges global and project settings with project winning when project config is included", () => {
    const homeDir = path.join(tmpDir, "home");
    const projectDir = path.join(tmpDir, "project");

    fs.mkdirSync(path.join(homeDir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({
        autoMode: {
          defaultMode: "auto",
          classifier: {
            model: "anthropic/claude-sonnet-4",
            environment: ["Global env"],
            hardDeny: ["Global hard"],
            softDeny: ["$defaults", "Global soft"],
            allow: ["$defaults"],
            timeoutMs: 5000,
          },
          denyAndContinue: {
            maxConsecutiveDenials: 5,
            maxTotalDenials: 50,
          },
        },
      }),
    );

    fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({
        autoMode: {
          defaultMode: "dontAsk",
          classifier: {
            model: "openai/gpt-4o",
            environment: ["Project env"],
            hardDeny: ["Project hard"],
            softDeny: ["$defaults", "Project soft"],
            allow: ["$defaults", "Project allow"],
            timeoutMs: 2000,
          },
          denyAndContinue: {
            maxConsecutiveDenials: 2,
            maxTotalDenials: 10,
          },
        },
      }),
    );

    const config = loadConfig(projectDir, homeDir, { includeProject: true });

    expect(config.defaultMode).toBe("dontAsk");
    expect(config.classifier.model).toBe("openai/gpt-4o");
    expect(config.classifier.timeoutMs).toBe(2000);
    expect(config.classifier.environment).toEqual(["Project env"]);
    expect(config.classifier.hardDeny).toEqual(["Project hard"]);
    expect(config.classifier.softDeny).toContain("Project soft");
    expect(config.classifier.softDeny).not.toContain("$defaults");
    expect(config.classifier.allow).toContain("Project allow");
    expect(config.classifier.allow).not.toContain("$defaults");
    expect(config.denyAndContinue.maxConsecutiveDenials).toBe(2);
    expect(config.denyAndContinue.maxTotalDenials).toBe(10);
  });

  it("falls back to global settings when project config is not included", () => {
    const homeDir = path.join(tmpDir, "home");
    const projectDir = path.join(tmpDir, "project");

    fs.mkdirSync(path.join(homeDir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({
        autoMode: {
          defaultMode: "auto",
          classifier: { model: "anthropic/claude-sonnet-4" },
        },
      }),
    );

    fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({
        autoMode: {
          defaultMode: "dontAsk",
          classifier: { model: "openai/gpt-4o" },
        },
      }),
    );

    const config = loadConfig(projectDir, homeDir, { includeProject: false });
    expect(config.defaultMode).toBe("auto");
    expect(config.classifier.model).toBe("anthropic/claude-sonnet-4");
  });

  it("falls back to global settings when no project settings exist", () => {
    const homeDir = path.join(tmpDir, "home");
    const projectDir = path.join(tmpDir, "project");

    fs.mkdirSync(path.join(homeDir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({
        autoMode: {
          defaultMode: "auto",
          classifier: { model: "anthropic/claude-sonnet-4" },
        },
      }),
    );

    fs.mkdirSync(projectDir, { recursive: true });

    const config = loadConfig(projectDir, homeDir, { includeProject: false });
    expect(config.defaultMode).toBe("auto");
    expect(config.classifier.model).toBe("anthropic/claude-sonnet-4");
  });

  it("uses defaults when no settings files exist", () => {
    const projectDir = path.join(tmpDir, "empty-project");
    fs.mkdirSync(projectDir, { recursive: true });

    const config = loadConfig(projectDir, path.join(tmpDir, "nonexistent"), { includeProject: false });
    expect(config.defaultMode).toBe("off");
    expect(config.classifier.model).toBeNull();
    expect(config.classifier.prompt).toBeNull();
    expect(config.classifier.environment.length).toBeGreaterThan(0);
    expect(config.classifier.hardDeny.length).toBeGreaterThan(0);
    expect(config.classifier.softDeny.length).toBeGreaterThan(0);
    expect(config.classifier.allow.length).toBeGreaterThan(0);
    expect(config.classifier.timeoutMs).toBe(3000);
    expect(config.denyAndContinue.maxConsecutiveDenials).toBe(3);
    expect(config.denyAndContinue.maxTotalDenials).toBe(20);
  });
});
