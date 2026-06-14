import type { ResolvedConfig } from "./types";

export function createDenyContinueManager() {
  let consecutiveDenials = 0;
  let totalDenials = 0;
  const blockedToolCalls = new Map<string, string>();

  return {
    buildDenialMessage(reason: string): string {
      return [
        "This action was blocked by the permission gate.",
        "",
        `Reason: ${reason}`,
        "",
        "Please try a different, safer approach.",
      ].join("\n");
    },

    recordBlock(toolCallId: string, reason: string) {
      consecutiveDenials++;
      totalDenials++;
      blockedToolCalls.set(toolCallId, reason);
    },

    recordAllow() {
      consecutiveDenials = 0;
    },

    isBlocked(toolCallId: string): boolean {
      return blockedToolCalls.has(toolCallId);
    },

    getReason(toolCallId: string): string | undefined {
      return blockedToolCalls.get(toolCallId);
    },

    consumeBlocked(toolCallId: string): string | undefined {
      const reason = blockedToolCalls.get(toolCallId);
      blockedToolCalls.delete(toolCallId);
      return reason;
    },

    getConsecutiveDenials(): number {
      return consecutiveDenials;
    },

    getTotalDenials(): number {
      return totalDenials;
    },

    isThresholdBreached(config: ResolvedConfig): boolean {
      return (
        consecutiveDenials >= config.denyAndContinue.maxConsecutiveDenials ||
        totalDenials >= config.denyAndContinue.maxTotalDenials
      );
    },

    reset() {
      consecutiveDenials = 0;
      totalDenials = 0;
      blockedToolCalls.clear();
    },
  };
}

export type DenyContinueManager = ReturnType<typeof createDenyContinueManager>;
