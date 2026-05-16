import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { loadConfig } from "./config";
import { createModeManager } from "./mode";
import { makeDecision } from "./decision";

export default function (pi: ExtensionAPI) {
  const config = loadConfig(process.cwd());
  const modeManager = createModeManager(pi, config.defaultMode);
  modeManager.setup();

  pi.on("tool_call", async (event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const transcript: Message[] = entries
      .filter((e): e is { type: "message"; message: Message } => e.type === "message")
      .map((e) => e.message);

    const decision = await makeDecision(
      modeManager.getMode(),
      event.toolName,
      event.input,
      ctx,
      config,
      transcript,
    );
    if (decision.block) {
      return { block: true, reason: decision.reason };
    }
  });
}
