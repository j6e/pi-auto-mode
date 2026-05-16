import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionMode } from "./types";

const MODES: PermissionMode[] = ["off", "auto", "dontAsk"];

export function isValidMode(mode: unknown): mode is PermissionMode {
  return mode === "off" || mode === "auto" || mode === "dontAsk";
}

export function resolveInitialMode(
  flagValue: string | boolean | undefined,
  sessionEntries: Array<{ customType?: string; data?: unknown }>,
  settingsDefault: PermissionMode,
): PermissionMode {
  // 1. CLI flag
  if (typeof flagValue === "string" && isValidMode(flagValue)) {
    return flagValue;
  }

  // 2. Session state (most recent)
  let sessionMode: PermissionMode | undefined;
  for (const entry of sessionEntries) {
    if (entry.customType === "auto-mode-state") {
      const data = entry.data as Record<string, unknown> | undefined;
      if (data && isValidMode(data.mode)) {
        sessionMode = data.mode;
      }
    }
  }
  if (sessionMode) return sessionMode;

  // 3. Settings default
  if (isValidMode(settingsDefault)) return settingsDefault;

  // 4. Off
  return "off";
}

export function cycleMode(current: PermissionMode): PermissionMode {
  const idx = MODES.indexOf(current);
  return MODES[(idx + 1) % MODES.length];
}

export interface ModeManager {
  getMode(): PermissionMode;
  setMode(mode: PermissionMode, ctx: ExtensionContext): void;
  cycleMode(ctx: ExtensionContext): void;
  setup(): void;
}

export function createModeManager(pi: ExtensionAPI, settingsDefault: PermissionMode): ModeManager {
  let currentMode: PermissionMode = "off";

  function updateStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus("auto-mode", `auto-mode: ${currentMode}`);
  }

  function persistAndUpdate(mode: PermissionMode, ctx: ExtensionContext) {
    currentMode = mode;
    pi.appendEntry("auto-mode-state", { mode });
    updateStatus(ctx);
  }

  return {
    getMode() {
      return currentMode;
    },
    setMode(mode, ctx) {
      persistAndUpdate(mode, ctx);
    },
    cycleMode(ctx) {
      persistAndUpdate(cycleMode(currentMode), ctx);
    },
    setup() {
      pi.registerFlag("auto-mode", {
        description: "Set auto mode (off, auto, dontAsk)",
        type: "string",
        default: undefined,
      });

      pi.registerCommand("auto-mode", {
        description: "Cycle through auto-mode states (off → auto → dontAsk)",
        handler: async (_args, ctx) => {
          persistAndUpdate(cycleMode(currentMode), ctx);
        },
      });

      pi.registerShortcut("ctrl+shift+a", {
        description: "Toggle auto-mode",
        handler: async (ctx) => {
          persistAndUpdate(cycleMode(currentMode), ctx);
        },
      });

      pi.on("session_start", async (_event, ctx) => {
        const flagValue = pi.getFlag("auto-mode");

        // In non-interactive mode without explicit flag, force off
        if (!ctx.hasUI && !flagValue) {
          currentMode = "off";
          updateStatus(ctx);
          return;
        }

        const entries = ctx.sessionManager.getEntries();
        const customEntries = entries
          .filter((e) => "customType" in e)
          .map((e) => ({ customType: (e as any).customType, data: (e as any).data }));
        const mode = resolveInitialMode(flagValue, customEntries, settingsDefault);
        currentMode = mode;
        updateStatus(ctx);
      });
    },
  };
}
