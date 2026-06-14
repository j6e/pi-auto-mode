import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

interface ActiveSessionManager {
  buildSessionContext(): { messages: unknown[] };
  getBranch(): unknown[];
}

function getActiveSessionManager(ctx: ExtensionContext): ActiveSessionManager {
  return ctx.sessionManager as unknown as ActiveSessionManager;
}

function isUserMessage(message: unknown): message is Message {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "user"
  );
}

export interface AutoModeStateEntry {
  data?: unknown;
}

export function getClassifierTranscript(ctx: ExtensionContext): Message[] {
  return getActiveSessionManager(ctx).buildSessionContext().messages.filter(isUserMessage);
}

export function getActiveAutoModeStateEntries(ctx: ExtensionContext): AutoModeStateEntry[] {
  return getActiveSessionManager(ctx)
    .getBranch()
    .filter(
      (entry): entry is { type: "custom"; customType: string; data?: unknown } =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === "custom" &&
        (entry as { customType?: unknown }).customType === "auto-mode-state",
    )
    .map((entry) => ({ data: entry.data }));
}
