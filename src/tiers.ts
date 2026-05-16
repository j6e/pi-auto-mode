import * as path from "node:path";

const PROTECTED_PATTERNS = [
  ".git/",
  ".env",
  ".env.",
  ".pi/",
  "node_modules/",
  "~/.bashrc",
  "~/.zshrc",
  "~/.ssh/",
];

const TIER_1_TOOLS = new Set(["read", "grep", "find", "ls"]);
const TIER_2_TOOLS = new Set(["write", "edit"]);

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

export function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of PROTECTED_PATTERNS) {
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
): TierResult {
  // Tier 1: Always allow
  if (TIER_1_TOOLS.has(toolName)) {
    return { kind: "allow" };
  }

  const targetPath = getPathFromInput(toolName, input);

  // Protected paths check
  if (targetPath && isProtectedPath(targetPath)) {
    return { kind: "block", reason: `Blocked: path "${targetPath}" is protected` };
  }

  // Tier 2: Auto-allow in auto mode only
  if (TIER_2_TOOLS.has(toolName) && targetPath) {
    if (isWithinCwd(targetPath, cwd)) {
      return { kind: "allow" };
    }
  }

  // Everything else goes to classifier
  return { kind: "evaluate" };
}
