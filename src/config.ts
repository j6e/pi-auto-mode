import type { AutoModeSettings, ResolvedConfig, PermissionMode, ClassifierToolMode } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_MODE: PermissionMode = "off";
const DEFAULT_MAX_CONSECUTIVE = 3;
const DEFAULT_MAX_TOTAL = 20;
const DEFAULT_CLASSIFIER_TIMEOUT_MS = 3000;
const DEFAULT_CLASSIFIER_TOOL_MODE: ClassifierToolMode = "force";

const DEFAULT_PROTECTED_PATHS = [
  ".git/",
  ".env",
  ".env.",
  ".pi/",
  "node_modules/",
  "~/.bashrc",
  "~/.zshrc",
  "~/.ssh/",
];

const DEFAULT_TOOLS = {
  alwaysAllow: ["read", "grep", "find", "ls"],
  allowInProject: ["write", "edit"],
  alwaysEvaluate: [],
  alwaysBlock: [],
};

const BUILTIN_DEFAULTS = {
  environment: [
    "This is a standard software development environment.",
    "The user is a software engineer working on a codebase.",
  ],
  hardDeny: [
    "Never delete .git directories or modify git internals.",
    "Never modify .env files, .env.* files, or SSH keys in ~/.ssh/.",
    "Never modify shell configuration files like ~/.bashrc or ~/.zshrc.",
    "Never run rm -rf on system directories or node_modules/ without explicit user intent.",
  ],
  softDeny: [
    "Be cautious with external API calls that may transmit sensitive data.",
    "Be cautious with commands that modify infrastructure or deploy to production.",
  ],
  allow: [
    "Reading files and searching code is always allowed.",
    "Writing and editing files within the current project directory is allowed.",
    "Running standard build, test, and lint commands is allowed.",
  ],
};

function expandDefaults(arr: string[] | undefined, builtin: string[]): string[] {
  if (!Array.isArray(arr)) return [...builtin];
  const result: string[] = [];
  for (const item of arr) {
    if (item === "$defaults") {
      result.push(...builtin);
    } else {
      result.push(item);
    }
  }
  return result;
}

function isValidMode(mode: unknown): mode is PermissionMode {
  return mode === "off" || mode === "auto" || mode === "dontAsk";
}

function sanitizeString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null) return null;
  return null;
}

function sanitizeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function isValidClassifierToolMode(value: unknown): value is ClassifierToolMode {
  return value === "force" || value === "required" || value === "auto";
}

export function resolveConfig(
  globalSettings?: AutoModeSettings,
  projectSettings?: AutoModeSettings,
): ResolvedConfig {
  const merged: ResolvedConfig = {
    defaultMode: DEFAULT_MODE,
    classifier: {
      model: null,
      prompt: null,
      environment: ["$defaults"],
      hardDeny: ["$defaults"],
      softDeny: ["$defaults"],
      allow: ["$defaults"],
      timeoutMs: DEFAULT_CLASSIFIER_TIMEOUT_MS,
      toolMode: DEFAULT_CLASSIFIER_TOOL_MODE,
    },
    denyAndContinue: {
      maxConsecutiveDenials: DEFAULT_MAX_CONSECUTIVE,
      maxTotalDenials: DEFAULT_MAX_TOTAL,
    },
    tools: { ...DEFAULT_TOOLS },
    protectedPaths: [...DEFAULT_PROTECTED_PATHS],
  };

  function mergeLayer(settings: AutoModeSettings | undefined) {
    if (!settings) return;
    if (isValidMode(settings.defaultMode)) {
      merged.defaultMode = settings.defaultMode;
    }
    if (settings.classifier) {
      merged.classifier.model = sanitizeString(settings.classifier.model) ?? merged.classifier.model;
      merged.classifier.prompt = sanitizeString(settings.classifier.prompt) ?? merged.classifier.prompt;
      if (Array.isArray(settings.classifier.environment)) {
        merged.classifier.environment = settings.classifier.environment;
      }
      if (Array.isArray(settings.classifier.hardDeny)) {
        merged.classifier.hardDeny = settings.classifier.hardDeny;
      }
      if (Array.isArray(settings.classifier.softDeny)) {
        merged.classifier.softDeny = settings.classifier.softDeny;
      }
      if (Array.isArray(settings.classifier.allow)) {
        merged.classifier.allow = settings.classifier.allow;
      }
      if (typeof settings.classifier.timeoutMs === "number" && Number.isFinite(settings.classifier.timeoutMs)) {
        merged.classifier.timeoutMs = settings.classifier.timeoutMs;
      }
      if (isValidClassifierToolMode(settings.classifier.toolMode)) {
        merged.classifier.toolMode = settings.classifier.toolMode;
      }
    }
    if (settings.denyAndContinue) {
      merged.denyAndContinue.maxConsecutiveDenials = sanitizeNumber(
        settings.denyAndContinue.maxConsecutiveDenials,
        DEFAULT_MAX_CONSECUTIVE,
      );
      merged.denyAndContinue.maxTotalDenials = sanitizeNumber(
        settings.denyAndContinue.maxTotalDenials,
        DEFAULT_MAX_TOTAL,
      );
    }
    if (settings.tools) {
      if (Array.isArray(settings.tools.alwaysAllow)) merged.tools.alwaysAllow = settings.tools.alwaysAllow;
      if (Array.isArray(settings.tools.allowInProject)) merged.tools.allowInProject = settings.tools.allowInProject;
      if (Array.isArray(settings.tools.alwaysEvaluate)) merged.tools.alwaysEvaluate = settings.tools.alwaysEvaluate;
      if (Array.isArray(settings.tools.alwaysBlock)) merged.tools.alwaysBlock = settings.tools.alwaysBlock;
    }
    if (Array.isArray(settings.protectedPaths)) {
      merged.protectedPaths = settings.protectedPaths;
    }
  }

  mergeLayer(globalSettings);
  mergeLayer(projectSettings);

  return {
    defaultMode: merged.defaultMode,
    classifier: {
      model: merged.classifier.model,
      prompt: merged.classifier.prompt,
      environment: expandDefaults(merged.classifier.environment, BUILTIN_DEFAULTS.environment),
      hardDeny: expandDefaults(merged.classifier.hardDeny, BUILTIN_DEFAULTS.hardDeny),
      softDeny: expandDefaults(merged.classifier.softDeny, BUILTIN_DEFAULTS.softDeny),
      allow: expandDefaults(merged.classifier.allow, BUILTIN_DEFAULTS.allow),
      timeoutMs: merged.classifier.timeoutMs,
      toolMode: merged.classifier.toolMode,
    },
    denyAndContinue: {
      maxConsecutiveDenials: merged.denyAndContinue.maxConsecutiveDenials,
      maxTotalDenials: merged.denyAndContinue.maxTotalDenials,
    },
    tools: {
      alwaysAllow: merged.tools.alwaysAllow,
      allowInProject: merged.tools.allowInProject,
      alwaysEvaluate: merged.tools.alwaysEvaluate,
      alwaysBlock: merged.tools.alwaysBlock,
    },
    protectedPaths: merged.protectedPaths,
  };
}

export interface LoadConfigOptions {
  includeProject?: boolean;
}

export function loadConfig(cwd: string, homeDir = os.homedir(), options: LoadConfigOptions = {}): ResolvedConfig {
  let globalSettings: AutoModeSettings | undefined;
  let projectSettings: AutoModeSettings | undefined;

  const globalSettingsPath = path.join(homeDir, ".pi", "agent", "settings.json");
  try {
    const raw = fs.readFileSync(globalSettingsPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "autoMode" in parsed) {
      globalSettings = parsed.autoMode as AutoModeSettings;
    }
  } catch {
    // file doesn't exist or is malformed — proceed without global settings
  }

  if (options.includeProject ?? true) {
    const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
    try {
      const raw = fs.readFileSync(projectSettingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "autoMode" in parsed) {
        projectSettings = parsed.autoMode as AutoModeSettings;
      }
    } catch {
      // file doesn't exist or is malformed — proceed without project settings
    }
  }

  return resolveConfig(globalSettings, projectSettings);
}
