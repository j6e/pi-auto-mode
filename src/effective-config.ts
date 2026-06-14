import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import { loadConfig } from "./config";
import type { ResolvedConfig } from "./types";

export interface EffectiveConfigResult {
  config: ResolvedConfig;
  includesProject: boolean;
}

export function resolveEffectiveConfig(ctx: ExtensionContext, homeDir = os.homedir()): EffectiveConfigResult {
  const includesProject = ctx.isProjectTrusted();
  return {
    config: loadConfig(ctx.cwd, homeDir, { includeProject: includesProject }),
    includesProject,
  };
}
