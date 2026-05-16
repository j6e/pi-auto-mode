import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import type { PermissionMode, ResolvedConfig } from "./types";
import { evaluateTier } from "./tiers";
import { classify } from "./classifier";

export interface DecisionAllow {
  allow: true;
}
export interface DecisionBlock {
  block: true;
  reason: string;
}
export type DecisionResult = DecisionAllow | DecisionBlock;

export async function makeDecision(
  mode: PermissionMode,
  toolName: string,
  input: Record<string, unknown>,
  ctx: ExtensionContext,
  config: ResolvedConfig,
  transcript: Message[],
  currentMode: string,
): Promise<DecisionResult> {
  const tier = evaluateTier(toolName, input, ctx.cwd, config);

  // Protected paths are blocked unconditionally in all modes
  if (tier.kind === "block") {
    return { block: true, reason: tier.reason };
  }

  if (mode === "off") {
    return { allow: true };
  }

  if (tier.kind === "allow") {
    return { allow: true };
  }

  // tier.kind === "evaluate"
  if (mode === "dontAsk") {
    return { block: true, reason: "Blocked: tool not in auto-allow tier (dontAsk mode)" };
  }

  // auto mode: call the real classifier
  try {
    const classifierDecision = await classify(config, toolName, input, transcript, ctx, currentMode);
    if (classifierDecision.decision === "allow") {
      return { allow: true };
    }
    return { block: true, reason: classifierDecision.reason };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ctx.hasUI) {
      const ok = await ctx.ui.confirm(
        "Classifier failed",
        `${message}\n\nAllow this action?`,
      );
      if (ok) {
        return { allow: true };
      }
    }
    return { block: true, reason: message };
  }
}
