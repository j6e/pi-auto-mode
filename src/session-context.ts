import { buildSessionContext, type CustomEntry, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

function isUserMessage(message: unknown): message is Message {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "user"
  );
}

export interface AutoModeStateEntry {
  customType: "auto-mode-state";
  data?: unknown;
}

export function getClassifierTranscript(ctx: ExtensionContext): Message[] {
  return buildSessionContext(ctx.sessionManager.getBranch()).messages.filter(isUserMessage);
}

export function getActiveAutoModeStateEntries(ctx: ExtensionContext): AutoModeStateEntry[] {
  return ctx.sessionManager
    .getBranch()
    .filter(
      (entry): entry is CustomEntry & { customType: "auto-mode-state" } =>
        entry.type === "custom" && entry.customType === "auto-mode-state",
    )
    .map((entry) => ({ customType: entry.customType, data: entry.data }));
}
