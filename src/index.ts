import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config";
import { createModeManager } from "./mode";

export default function (pi: ExtensionAPI) {
  const config = loadConfig(process.cwd());
  const modeManager = createModeManager(pi, config.defaultMode);
  modeManager.setup();
}
