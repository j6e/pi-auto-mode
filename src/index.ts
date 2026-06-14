import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { resolveEffectiveConfig } from "./effective-config";
import { createModeManager } from "./mode";
import { makeDecision } from "./decision";
import { createDenyContinueManager } from "./deny-continue";
import { getClassifierTranscript } from "./session-context";

export default function (pi: ExtensionAPI) {
  const modeManager = createModeManager(pi, resolveEffectiveConfig);
  const denyManager = createDenyContinueManager();
  modeManager.setup();

  pi.on("session_start", async (_event, _ctx) => {
    denyManager.reset();
  });

  pi.on("tool_call", async (event, ctx) => {
    const { config } = resolveEffectiveConfig(ctx);
    const transcript: Message[] = getClassifierTranscript(ctx);

    const decision = await makeDecision(
      modeManager.getMode(),
      event.toolName,
      event.input,
      ctx,
      config,
      transcript,
      modeManager.getMode(),
    );

    if ("allow" in decision) {
      denyManager.recordAllow();
      return undefined;
    }

    // Block
    denyManager.recordBlock(event.toolCallId, decision.reason);

    if (ctx.hasUI) {
      ctx.ui.notify(`Blocked: ${decision.reason}`, "warning");
    }

    if (denyManager.isThresholdBreached(config)) {
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          "Auto-mode threshold reached",
          `The agent has been blocked ${denyManager.getConsecutiveDenials()} consecutive times. Allow this action?`,
        );
        if (ok) {
          denyManager.recordAllow();
          denyManager.consumeBlocked(event.toolCallId);
          return undefined;
        }
      } else {
        ctx.shutdown();
      }
    }

    return { block: true, reason: decision.reason };
  });

  pi.on("tool_result", async (event, _ctx) => {
    const reason = denyManager.consumeBlocked(event.toolCallId);
    if (reason) {
      const message = denyManager.buildDenialMessage(reason);
      return {
        content: [{ type: "text", text: message }],
      };
    }
    return undefined;
  });
}
