import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config";
import { createModeManager } from "./mode";
import { makeDecision } from "./decision";

export default function (pi: ExtensionAPI) {
  const config = loadConfig(process.cwd());
  const modeManager = createModeManager(pi, config.defaultMode);
  modeManager.setup();

  pi.on("tool_call", async (event, ctx) => {
    const decision = await makeDecision(modeManager.getMode(), event.toolName, event.input, ctx);
    if (decision.block) {
      return { block: true, reason: decision.reason };
    }
  });
}
