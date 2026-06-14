import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutoModeSettings, PermissionMode, ResolvedConfig } from "./types";
import { isValidMode } from "./mode";
import { isProjectTrusted } from "./project-trust";

const LIST_KEYS = new Set([
  "classifier.environment",
  "classifier.hardDeny",
  "classifier.softDeny",
  "classifier.allow",
  "protectedPaths",
  "tools.alwaysAllow",
  "tools.allowInProject",
  "tools.alwaysEvaluate",
  "tools.alwaysBlock",
]);

const SCALAR_KEYS = new Set([
  "defaultMode",
  "classifier.model",
  "classifier.prompt",
  "classifier.timeoutMs",
  "classifier.toolMode",
  "denyAndContinue.maxConsecutiveDenials",
  "denyAndContinue.maxTotalDenials",
]);

function settingsPath(cwd: string): string {
  return path.join(cwd, ".pi", "settings.json");
}

function readSettings(cwd: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(cwd), "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(cwd: string, settings: Record<string, unknown>) {
  const file = settingsPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function ensureAutoMode(settings: Record<string, unknown>): any {
  if (!settings.autoMode || typeof settings.autoMode !== "object") settings.autoMode = {};
  return settings.autoMode;
}

function getPath(obj: any, key: string): unknown {
  return key.split(".").reduce((cur, part) => cur?.[part], obj);
}

function setPath(obj: any, key: string, value: unknown) {
  const parts = key.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cur[part] || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]!] = value;
}

function deletePath(obj: any, key: string) {
  const parts = key.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cur?.[part] || typeof cur[part] !== "object") return;
    cur = cur[part];
  }
  delete cur[parts[parts.length - 1]!];
}

function parseValue(key: string, raw: string): unknown {
  if (raw === "null") return null;
  if (key === "defaultMode") {
    if (!isValidMode(raw)) throw new Error("defaultMode must be off, auto, or dontAsk");
    return raw;
  }
  if (key === "classifier.toolMode") {
    if (!["force", "required", "auto"].includes(raw)) throw new Error("classifier.toolMode must be force, required, or auto");
    return raw;
  }
  if (key === "classifier.timeoutMs" || key.startsWith("denyAndContinue.")) {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    return n;
  }
  return raw;
}

function format(config: ResolvedConfig): string {
  return JSON.stringify(config, null, 2);
}

function formatStatusConfig(config: ResolvedConfig): string {
  return JSON.stringify(
    {
      ...config,
      classifier: {
        ...config.classifier,
        prompt: config.classifier.prompt ?? "<built-in>",
      },
    },
    null,
    2,
  );
}

export interface AutoModeCommandDeps {
  getConfig(): ResolvedConfig;
  reloadConfigForContext(ctx: ExtensionContext): ResolvedConfig;
  getMode(): PermissionMode;
  setMode(mode: PermissionMode, ctx: ExtensionContext): void;
}

export async function handleAutoModeCommand(args: string, ctx: ExtensionContext, deps: AutoModeCommandDeps): Promise<void> {
  const tokens = args.trim().match(/(?:[^\s"]+|"[^"]*")+/g)?.map((t) => t.replace(/^"|"$/g, "")) ?? [];
  const [first, second, third, ...rest] = tokens;

  try {
    if (!first || first === "cycle") return;
    if (first === "status") {
      ctx.ui.notify(`Mode: ${deps.getMode()}\n\nEffective config:\n${formatStatusConfig(deps.getConfig())}`, "info");
      return;
    }
    if (first === "set") {
      if (!isValidMode(second)) throw new Error("usage: /auto-mode set <off|auto|dontAsk>");
      deps.setMode(second, ctx);
      ctx.ui.notify(`auto-mode: ${second}`, "info");
      return;
    }
    if (first !== "config") throw new Error("usage: /auto-mode [status|set|config]");

    if (!second) {
      ctx.ui.notify(format(deps.getConfig()), "info");
      return;
    }
    if (second === "edit") {
      ctx.ui.notify(`Edit project config at ${settingsPath(ctx.cwd)}`, "info");
      return;
    }

    const key = third;
    if (!key) throw new Error("usage: /auto-mode config <get|set|add|remove|reset> <key> [value]");

    if (second === "get") {
      ctx.ui.notify(JSON.stringify(getPath(deps.getConfig(), key), null, 2), "info");
      return;
    }

    const settings = readSettings(ctx.cwd);
    const autoMode = ensureAutoMode(settings) as AutoModeSettings;

    if (second === "reset") {
      deletePath(autoMode, key);
      writeSettings(ctx.cwd, settings);
      deps.reloadConfigForContext(ctx);
      ctx.ui.notify(`Reset ${key}`, "info");
      if (!isProjectTrusted(ctx)) {
        ctx.ui.notify(
          "Project is not trusted, so project-local auto-mode settings are not currently loaded. Review .pi/settings.json before trusting the project.",
          "warning",
        );
      }
      return;
    }

    const rawValue = rest.join(" ");
    if (!rawValue) throw new Error(`usage: /auto-mode config ${second} ${key} <value>`);

    if (second === "set") {
      if (!SCALAR_KEYS.has(key) && !LIST_KEYS.has(key)) throw new Error(`Unknown config key: ${key}`);
      const value = LIST_KEYS.has(key) ? rawValue.split(",").map((s) => s.trim()).filter(Boolean) : parseValue(key, rawValue);
      setPath(autoMode, key, value);
    } else if (second === "add" || second === "remove") {
      if (!LIST_KEYS.has(key)) throw new Error(`${key} is not a list key`);
      const current = getPath(autoMode, key);
      const list = Array.isArray(current) ? [...current] : [];
      if (second === "add" && !list.includes(rawValue)) list.push(rawValue);
      if (second === "remove") {
        const idx = list.indexOf(rawValue);
        if (idx >= 0) list.splice(idx, 1);
      }
      setPath(autoMode, key, list);
    } else {
      throw new Error("usage: /auto-mode config <get|set|add|remove|reset|edit>");
    }

    writeSettings(ctx.cwd, settings);
    deps.reloadConfigForContext(ctx);
    ctx.ui.notify(`Updated ${key}`, "info");
    if (!isProjectTrusted(ctx)) {
      ctx.ui.notify(
        "Project is not trusted, so project-local auto-mode settings are not currently loaded. Review .pi/settings.json before trusting the project.",
        "warning",
      );
    }
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
