import * as path from "node:path";
import type { ResolvedConfig } from "./types";

const DEFAULT_CONFIG: Pick<ResolvedConfig, "tools" | "protectedPaths"> = {
  protectedPaths: [".git/", ".env", ".env.", ".pi/", "node_modules/", "~/.bashrc", "~/.zshrc", "~/.ssh/"],
  tools: {
    alwaysAllow: ["read", "grep", "find", "ls"],
    allowInProject: ["write", "edit"],
    alwaysEvaluate: [],
    alwaysBlock: [],
  },
};

export interface TierResultAllow {
  kind: "allow";
}
export interface TierResultBlock {
  kind: "block";
  reason: string;
}
export interface TierResultEvaluate {
  kind: "evaluate";
}
export type TierResult = TierResultAllow | TierResultBlock | TierResultEvaluate;

export function isProtectedPath(filePath: string, protectedPatterns = DEFAULT_CONFIG.protectedPaths): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of protectedPatterns) {
    if (pattern.endsWith("/")) {
      if (normalized.includes(pattern)) return true;
    } else if (pattern.startsWith(".env.")) {
      if (normalized.includes(pattern)) return true;
    } else if (pattern === ".env") {
      const segments = normalized.split("/");
      const filename = segments[segments.length - 1];
      if (filename === ".env" || filename.startsWith(".env.")) return true;
    } else {
      if (normalized.includes(pattern)) return true;
    }
  }
  return false;
}

function getPathFromInput(toolName: string, input: Record<string, unknown>): string | undefined {
  if (typeof input.path === "string") return input.path;
  if (toolName === "bash" && typeof input.command === "string") {
    return input.command;
  }
  return undefined;
}

function isWithinCwd(filePath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, filePath);
  const resolvedCwd = path.resolve(cwd);
  const relative = path.relative(resolvedCwd, resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function evaluateTier(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  config: Pick<ResolvedConfig, "tools" | "protectedPaths"> = DEFAULT_CONFIG,
): TierResult {
  const effective = {
    protectedPaths: config.protectedPaths ?? DEFAULT_CONFIG.protectedPaths,
    tools: { ...DEFAULT_CONFIG.tools, ...(config.tools ?? {}) },
  };

  if (effective.tools.alwaysBlock.includes(toolName)) {
    return { kind: "block", reason: `Blocked: tool "${toolName}" is always blocked` };
  }

  const targetPath = getPathFromInput(toolName, input);

  if (targetPath && isProtectedPath(targetPath, effective.protectedPaths)) {
    return { kind: "block", reason: `Blocked: path "${targetPath}" is protected` };
  }

  if (effective.tools.alwaysAllow.includes(toolName)) {
    return { kind: "allow" };
  }

  if (!effective.tools.alwaysEvaluate.includes(toolName) && effective.tools.allowInProject.includes(toolName) && targetPath) {
    if (isWithinCwd(targetPath, cwd)) {
      return { kind: "allow" };
    }
  }

  return { kind: "evaluate" };
}
